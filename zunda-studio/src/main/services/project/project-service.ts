import { dirname, isAbsolute, relative, resolve } from 'node:path'

import type { Project } from '@shared/project/types'

import { AppError } from '../../core/errors'
import { fileExists } from '../../core/fs'
import type { MediaAccess } from '../../core/media-access'
import { readProject, writeProject } from './store'

/**
 * プロジェクトの読み書き。素材パスの解決と、素材の配信許可を担う。
 */
export class ProjectService {
  constructor(private readonly media: MediaAccess) {}

  async read(path: string): Promise<Project> {
    let project: Project
    try {
      project = await readProject(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError('NOT_FOUND', `プロジェクトが見つかりません: ${path}`)
      }
      throw new AppError('INVALID_ARGUMENT', `プロジェクトを読み込めません: ${(error as Error).message}`)
    }
    const resolved = await resolveAssetPaths(project, path)
    this.media.allowFiles(assetAbsolutePaths(resolved))
    return resolved
  }

  async write(path: string, project: Project): Promise<Project> {
    const withRelative = withRelativeAssetPaths(project, path)
    await writeProject(path, withRelative)
    this.media.allowFiles(assetAbsolutePaths(withRelative))
    return withRelative
  }
}

export function assetAbsolutePaths(project: Project): string[] {
  return Object.values(project.assets).map((asset) => asset.path.absolute)
}

/**
 * プロジェクトごと別の場所へ移された場合に備え、相対パスで見つかればそちらを優先する。
 */
export async function resolveAssetPaths(project: Project, projectPath: string): Promise<Project> {
  const base = dirname(projectPath)
  const assets = { ...project.assets }
  for (const [id, asset] of Object.entries(assets)) {
    if (asset.path.relative === null) continue
    const candidate = resolve(base, asset.path.relative)
    if (candidate !== asset.path.absolute && (await fileExists(candidate))) {
      assets[id] = { ...asset, path: { ...asset.path, absolute: candidate } }
    }
  }
  return { ...project, assets }
}

export function withRelativeAssetPaths(project: Project, projectPath: string): Project {
  const base = dirname(projectPath)
  const assets = { ...project.assets }
  for (const [id, asset] of Object.entries(assets)) {
    const relativePath = relative(base, asset.path.absolute)
    // Windows で別ドライブにあると relative は絶対パスを返す。その場合は相対パスを持たない。
    const usable = relativePath !== '' && !isAbsolute(relativePath)
    assets[id] = {
      ...asset,
      path: { absolute: asset.path.absolute, relative: usable ? relativePath.split('\\').join('/') : null }
    }
  }
  return { ...project, assets }
}
