# Historiska hus i Nordmaling

A map of historic houses in Nordmaling. A static web app on GitHub
Pages, with content edited through [Pages CMS](https://pagescms.org).

Code is in English; everything visitors and editors see is in Swedish.

## Development

Requires Node.js 22 or later.

```bash
npm install
npm run dev
```

Open <http://localhost:8080>. Run `npm run build` after changing anything.

Set `PREVIEW=1` when building to leave out the service worker, so changes show up
without a reload prompt.

## Structure

| Path | Contents |
|---|---|
| `content/places/` | One JSON file per place, edited in Pages CMS |
| `content/settings.json` | The app's name, short name, description and "Om" text |
| `media/` | Uploaded original images |
| `.pages.yml` | CMS field configuration |
| `site/` | The app: `index.html`, `app.js`, `style.css`, `sw.js` |
| `build.mjs` | Builds `_site/`: resizes images, writes `data.json` |
| `.github/workflows/deploy.yml` | Builds and deploys to GitHub Pages |

## Deployment

Every push to `main` is deployed to `/preview/`. The live map only changes when
the deploy workflow is run manually, which is what the **Publicera** button in
Pages CMS does.

To undo a publish, revert the change on `main` and publish again.

### Content

1. Sign in at [app.pagescms.org](https://app.pagescms.org) and open this repository.
2. Add, edit or remove places under **Platser**, then save. Each save is a commit to `main`.
3. Check the result at `/preview/` after a minute or two.
4. Press **Publicera** to make it live.

Publishing makes everything on `main` live, including other editors' saved changes.
To keep a place out of the map while working on it, turn off **Visa på kartan**.

### Code

1. Create a branch and make your changes. Test with `npm run dev`.
2. Open a pull request against `main`.
3. After merging, check the result at `/preview/`.
4. Publish by running the **Deploy** workflow from the Actions tab, or with
   **Publicera** in Pages CMS.

Keep code and comments in English and user-facing text in Swedish. Avoid new
dependencies and abstractions where plain code will do.
