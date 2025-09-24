# Deploying 4ttp to itch.io

## Checklist

- Run `npm run build`
- Zip the **contents** of `dist/` (do not include the folder itself)
- In Itch.io, create a new project and choose **HTML5**
- Upload the zip and set "This file will be played in the browser"
- Configure the viewport to 1280x720 and enable fullscreen
- Add the project description:
  - One-line pitch
  - Controls: keys 1-5, R, Space, Mouse input
  - Modes: Balance, Domination
  - Tools Used: ElevenLabs (voice pre-gen), Itch.io (hosting)
  - Include a link to [www.ChromaAwards.com](https://www.ChromaAwards.com) and note the Chroma logo in splash/credits
- Test the build in Safari, Chrome, and Firefox
- Confirm there are no external network calls or login requirements
