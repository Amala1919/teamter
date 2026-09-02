# Supplying your own card images

Drop an image in here named after a card id and that card will use it instead
of its generated illustration.

    public/assets/cards/goblin.png          -> the card whose id is "goblin"
    public/assets/cards/dark_angel_olivia.jpg

Accepted: `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`. Any size — the
renderer cover-fits the image into the art window and biases the crop upward,
because card art almost always puts its subject high.

Card ids are the filenames the game already uses; `npm run cards:report` lists
them, and a file whose name matches no card is reported by the scan rather than
silently ignored.

Then rebuild the manifest — a browser cannot list a directory, so the files
have to be enumerated for the renderer:

    npm run art:scan

## Recording where an image came from

`ASSET_LICENSES.md` requires every third-party asset to carry its source,
author, URL and licence. Put them in `credits.json` next to the images:

```json
{
  "goblin": {
    "source": "Example Free Art Library",
    "author": "A. Person",
    "url": "https://example.invalid/goblin",
    "license": "CC0 1.0"
  }
}
```

`npm run art:scan` lists any image with no entry. Images and `credits.json` are
gitignored: this repository ships no third-party artwork, and what you add here
is yours to account for.

## A note on what to put here

This project is for personal use only and is not distributed, so the images you
supply are your own business — but the licence record is still required, and
nothing here should be redistributed.
