import { useEffect, useRef, useState } from 'react'

import { MAX_CLIP_MS, visionTimes, type CohostCandidate, type CohostLine } from '@shared/ai/cohost'
import { formatModelRef } from '@shared/ai/types'
import type { Character, Project } from '@shared/project/types'

import { useCohostStore } from '../../state/ai'
import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { formatMs } from '../../lib/time'
import { Modal } from '../../ui/Modal'
import { NumberField } from '../../ui/NumberField'

/**
 * 相方(AI)に返答を書かせる操作と、返ってきた候補の確認(REQUIREMENTS.md B-3〜B-10)。
 * 候補はすぐには台本に入れず、利用者が直して採用したものだけを入れる。
 */
export function CohostControls({ onError }: { onError: (message: string | null) => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const defaultModel = useSettingsStore((state) => state.settings?.ai.roles.conversation ?? null)
  const session = useCohostStore((state) => state.session)
  const generate = useCohostStore((state) => state.generate)
  const requestSeq = useCohostStore((state) => state.requestSeq)
  const [candidates, setCandidates] = useState(2)
  const [rounds, setRounds] = useState(1)
  const [instruction, setInstruction] = useState('')
  const [synopsisOpen, setSynopsisOpen] = useState(false)
  // たたむと「生成」のボタンだけにして、台本を広く見せる(開き具合は覚えておく)。
  const [compact, setCompact] = useState(() => readCompact())
  // 画面を見せるか: none / frame(再生位置の画面) / clip(区間の映像)
  const [visionMode, setVisionMode] = useState<'none' | 'frame' | 'clip'>('none')
  const [clip, setClip] = useState({ startMs: 0, endMs: 5000 })
  const playheadMs = useEditorStore((state) => state.playheadMs)
  const hasVideo = project.items.some((item) => item.type === 'video')

  const characters = Object.values(project.characters)
  const aiCharacter = characters.find((character) => character.authorRole === 'ai')
  const userCharacter = characters.find((character) => character.authorRole === 'user')
  const configured = (project.ai.conversation ?? defaultModel) !== null
  const disabledReason = !configured
    ? '会話AIが未設定です(設定 → AI)'
    : !aiCharacter
      ? '相方(AIの役)のキャラクターがいません'
      : null

  const run = (characterId?: string): void => {
    onError(null)
    void generate({
      candidates,
      rounds: characterId ? 1 : rounds,
      ...(characterId ? { characterId } : {}),
      ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
      ...(visionMode === 'frame' ? { vision: { kind: 'frame' as const, atMs: playheadMs } } : {}),
      ...(visionMode === 'clip' ? { vision: { kind: 'clip' as const, startMs: clip.startMs, endMs: clip.endMs } } : {})
    })
  }

  // セリフの右クリックやショートカット(Ctrl+Shift+Enter)からの依頼。最初の描画では動かさない。
  const handledSeq = useRef(requestSeq)
  useEffect(() => {
    if (requestSeq === handledSeq.current) return
    handledSeq.current = requestSeq
    if (disabledReason !== null) {
      onError(disabledReason)
      return
    }
    if (session?.loading) return
    run()
    // run は毎回作り直されるので依存に入れない(依頼の回数が変わったときだけ動かす)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestSeq])

  return (
    <div className="cohost-controls" data-testid="cohost-controls">
      <div className="cohost-controls__row">
        <button
          type="button"
          className="button--primary"
          disabled={disabledReason !== null || session?.loading === true}
          title={disabledReason ?? '選んでいるセリフ(無ければ最後のセリフ)の後に続く返答を作ります(Ctrl+Shift+Enter)'}
          onClick={() => run()}
          data-testid="cohost-generate"
        >
          {session?.loading ? '考え中…' : '相方の返答を生成'}
        </button>
        <label className="field--inline">
          候補
          <select value={candidates} onChange={(event) => setCandidates(Number(event.target.value))} data-testid="cohost-candidates">
            {[1, 2, 3].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="field--inline">
          続ける数
          <select value={rounds} onChange={(event) => setRounds(Number(event.target.value))} data-testid="cohost-rounds" title="2以上にすると、自分のセリフも含めて会話の続きをまとめて作ります">
            {[1, 2, 3, 4, 6].map((value) => (
              <option key={value} value={value}>
                {value === 1 ? '返答だけ' : `${value}セリフ`}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button--small cohost-controls__toggle"
          onClick={() => {
            setCompact(!compact)
            writeCompact(!compact)
          }}
          title={compact ? '指示・画面などの設定を出す' : '設定をたたんで台本を広く見せる'}
          aria-expanded={!compact}
          data-testid="cohost-compact"
        >
          {compact ? '設定 ▴' : 'たたむ ▾'}
        </button>
      </div>
      {!compact && (
        <div className="cohost-controls__row">
        <input
          type="text"
          className="cohost-controls__instruction"
          value={instruction}
          placeholder="その場の指示(例: もっと辛口で / ボスの弱点に触れて)"
          onChange={(event) => setInstruction(event.target.value)}
          data-testid="cohost-instruction"
        />
        {userCharacter && (
          <button
            type="button"
            className="button--small"
            disabled={!configured || session?.loading === true}
            onClick={() => run(userCharacter.id)}
            title={`${userCharacter.name}(あなた)のセリフの案を出してもらいます`}
            data-testid="cohost-suggest-mine"
          >
            自分のセリフの案
          </button>
        )}
        <button type="button" className="button--small" onClick={() => setSynopsisOpen(true)} data-testid="open-synopsis">
          企画メモ
        </button>
        </div>
      )}
      {hasVideo && !compact && (
        <div className="cohost-controls__row cohost-controls__vision">
          <label className="field--inline">
            画面
            <select
              value={visionMode}
              onChange={(event) => {
                const mode = event.target.value as typeof visionMode
                setVisionMode(mode)
                // 区間の既定は、再生位置の5秒前から再生位置まで。
                if (mode === 'clip') setClip({ startMs: Math.max(0, playheadMs - 5000), endMs: Math.max(playheadMs, 1000) })
              }}
              title="相方にゲーム画面を見せて、画面の出来事も踏まえた返答を作らせます(画像を読めるモデルが必要)"
              data-testid="cohost-vision"
            >
              <option value="none">見せない</option>
              <option value="frame">再生位置の画面を見せる</option>
              <option value="clip">区間の映像を見せる</option>
            </select>
          </label>
          {visionMode === 'frame' && <span className="note">{formatMs(playheadMs)} の画面</span>}
          {visionMode === 'clip' && (
            <>
              <NumberField label="開始(秒)" value={clip.startMs} displayScale={0.001} step={0.5} min={0} onCommit={(startMs) => setClip({ ...clip, startMs })} testId="cohost-clip-start" />
              <NumberField label="終了(秒)" value={clip.endMs} displayScale={0.001} step={0.5} min={0} onCommit={(endMs) => setClip({ ...clip, endMs })} testId="cohost-clip-end" />
              <button type="button" className="button--small" onClick={() => setClip({ ...clip, startMs: playheadMs })} title="開始を再生位置にする">
                開始=再生位置
              </button>
              <button type="button" className="button--small" onClick={() => setClip({ ...clip, endMs: playheadMs })} title="終了を再生位置にする" data-testid="cohost-clip-end-here">
                終了=再生位置
              </button>
              <span className="note">{visionTimes({ kind: 'clip', ...clip }).length} コマに分けて見せます(最長{MAX_CLIP_MS / 1000}秒)</span>
            </>
          )}
        </div>
      )}
      {disabledReason && <p className="status status--warn">{disabledReason}</p>}
      {session && <CohostCandidates project={project} onError={onError} />}
      {synopsisOpen && <SynopsisDialog onClose={() => setSynopsisOpen(false)} />}
    </div>
  )
}

const COMPACT_KEY = 'zunda.cohostCompact'

function readCompact(): boolean {
  try {
    return localStorage.getItem(COMPACT_KEY) === '1'
  } catch {
    return false
  }
}

function writeCompact(value: boolean): void {
  try {
    localStorage.setItem(COMPACT_KEY, value ? '1' : '0')
  } catch {
    // 覚えられなくても動作には関係ない
  }
}

function CohostCandidates({ project, onError }: { project: Project; onError: (message: string | null) => void }): React.JSX.Element | null {
  const session = useCohostStore((state) => state.session)
  const regenerate = useCohostStore((state) => state.regenerate)
  const discard = useCohostStore((state) => state.discard)
  if (!session) return null
  const anchor = session.afterItemId ? project.items.find((item) => item.id === session.afterItemId) : undefined

  return (
    <div className="cohost-candidates" data-testid="cohost-candidates-panel">
      <div className="cohost-candidates__header">
        <span className="note">
          {anchor?.type === 'voice' ? `「${anchor.text.slice(0, 16)}${anchor.text.length > 16 ? '…' : ''}」の後に入れます` : '台本の最初に入れます'}
          {session.generatedBy && ` / ${formatModelRef(session.generatedBy)}`}
        </span>
        <span className="cohost-candidates__actions">
          <button type="button" className="button--small" disabled={session.loading} onClick={() => void regenerate()} data-testid="cohost-regenerate">
            再生成
          </button>
          <button type="button" className="button--small" onClick={discard} data-testid="cohost-discard">
            破棄
          </button>
        </span>
      </div>
      {session.loading && <p className="status">相方が返答を考えています…</p>}
      {session.vision && !session.loading && (
        <p className={`status ${session.vision.imagesDropped || session.vision.shownFrames === 0 ? 'status--warn' : ''}`} data-testid="cohost-vision-status">
          {session.vision.shownFrames === 0
            ? 'その時刻に映っている動画が無いため、画面は見せずに作りました'
            : session.vision.imagesDropped
              ? 'このモデル・接続方法は画像を読めないため、画面は見せずに文字だけで作りました(画像を読めるモデルを選んでください)'
              : `画面を ${session.vision.shownFrames} コマ見せて作りました`}
        </p>
      )}
      {session.error && (
        <p className="status status--error" role="alert" data-testid="cohost-error">
          {session.error}
        </p>
      )}
      {session.candidates.map((candidate, index) => (
        <CandidateCard key={`${index}-${session.generatedBy?.at ?? ''}`} project={project} candidate={candidate} index={index} onError={onError} />
      ))}
    </div>
  )
}

function CandidateCard({
  project,
  candidate,
  index,
  onError
}: {
  project: Project
  candidate: CohostCandidate
  index: number
  onError: (message: string | null) => void
}): React.JSX.Element {
  const adopt = useCohostStore((state) => state.adopt)
  const [lines, setLines] = useState<CohostLine[]>(candidate.lines)
  useEffect(() => setLines(candidate.lines), [candidate])

  const update = (position: number, patch: Partial<CohostLine>): void =>
    setLines((current) => current.map((line, lineIndex) => (lineIndex === position ? { ...line, ...patch } : line)))

  return (
    <article className="cohost-card" data-testid="cohost-candidate">
      <header className="cohost-card__header">
        <strong>案{index + 1}</strong>
        <button
          type="button"
          className="button--small button--primary"
          disabled={lines.some((line) => line.text.trim() === '')}
          onClick={() => {
            const result = adopt(lines.map((line) => ({ ...line, text: line.text.trim() })))
            onError(result.ok ? null : result.message)
          }}
          data-testid="cohost-adopt"
        >
          採用
        </button>
      </header>
      {lines.map((line, position) => {
        const character: Character | undefined = project.characters[line.characterId]
        const expressions = Object.values(character?.portrait?.expressions ?? {})
        return (
          <div key={position} className="cohost-card__line">
            <span className={`script__role script__role--${character?.authorRole ?? 'user'}`}>{character?.name ?? '?'}</span>
            <textarea
              rows={2}
              value={line.text}
              onChange={(event) => update(position, { text: event.target.value })}
              aria-label={`案${index + 1}の${position + 1}つ目のセリフ`}
              data-testid="cohost-line-text"
            />
            {expressions.length > 0 && (
              <select
                value={line.expressionId ?? ''}
                onChange={(event) => update(position, { expressionId: event.target.value || null })}
                aria-label="表情"
                data-testid="cohost-line-expression"
              >
                <option value="">表情: 既定</option>
                {expressions.map((expression) => (
                  <option key={expression.id} value={expression.id}>
                    {expression.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )
      })}
      {candidate.warnings.map((warning) => (
        <p key={warning} className="status status--warn" data-testid="cohost-warning">
          {warning}
        </p>
      ))}
    </article>
  )
}

function SynopsisDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const synopsis = useEditorStore((state) => state.project.meta.synopsis ?? '')
  const dispatch = useEditorStore((state) => state.dispatch)
  const [draft, setDraft] = useState(synopsis)
  return (
    <Modal
      title="企画メモ"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="button--primary"
          onClick={() => {
            if (draft !== synopsis) dispatch([{ op: 'project.setMeta', synopsis: draft }], '企画メモの変更')
            onClose()
          }}
          data-testid="synopsis-save"
        >
          保存
        </button>
      }
    >
      <p className="note">動画の題材や見どころを書いておくと、相方の返答や編集AIが話題からそれにくくなります。</p>
      <textarea
        rows={8}
        className="synopsis__text"
        value={draft}
        placeholder="例: 初見でホラーゲーム『〇〇』を遊ぶ回。ずんだもんが怖がり、めたんが冷静にツッコむ。見どころはボス戦の逆転。"
        onChange={(event) => setDraft(event.target.value)}
        data-testid="synopsis-text"
      />
    </Modal>
  )
}
