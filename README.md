# Social Media to Mealie

**Vibe Coding enhancements of Repo: [GerardPolloRebozado/social-to-mealie](https://github.com/GerardPolloRebozado/social-to-mealie)**

Have you found a recipe on social media and don’t want to write it out yourself? This tool lets you import recipes from
videos directly into [Mealie](https://github.com/mealie-recipes/mealie).

**Tested social media platforms:**

- Instagram
- TikTok
- Facebook
- YouTube Shorts
- Pinterest

Other sites may work as well, since the tool uses `yt-dlp` to download videos. If you encounter issues with other
websites, please open an issue.

> **Note:** If you receive a `BAD_RECIPE` error, it may be due to Mealie’s recipe parsing. If you find a better prompt
> or solution, feel free to open an issue or PR!

> **Note:** If Instagram imports fail with `Instagram sent an empty media response`, the post likely requires a
> logged-in session. Set the `COOKIES` environment variable with a valid `sessionid=...` cookie from your browser,
> and make sure `YTDLP_VERSION=latest` so yt-dlp stays current (see the table below).

## Features

- Import posts into Mealie with a link and a click
- [iOS Shortcut v0.3](https://www.icloud.com/shortcuts/3778d926ed794dca95e658c6a4b5cf11) for easy importing
- PWA for "share" feature on Android
- Imports run as background jobs on the server, so they keep going even if you background
  or close the app mid-import
- Optional push notification ("Rezept übertragen") once an import finishes, even if the app
  isn't open — see [Push Notifications](#push-notifications) below

## Screenshot

![Screenshot of the web interface](./public/screenshot.png "Screenshot of the web interface")

## Requirements

- [Mealie 1.9.0+](https://github.com/mealie-recipes/mealie) with AI provider
  configured ([docs](https://docs.mealie.io/documentation/getting-started/installation/open-ai/))
- [Docker](https://docs.docker.com/engine/install/)

## Deployment

<details open>
    <summary>Docker Compose</summary>

1. Create a `docker-compose.yml` file based on
   the [example](https://github.com/GerardPolloRebozado/social-to-mealie/blob/main/docker-compose.yml) in the repo and
   fill in the required environment variables, if you prefer having them in a separate file you can create a `.env` file
   based on the [example.env](https://github.com/GerardPolloRebozado/social-to-mealie/blob/main/example.env).

2. **Start the service with Docker Compose:**
    ```sh
    docker-compose up -d
    ```
    </details>

<details>
    <summary>Docker Run</summary>

```sh
docker run --restart unless-stopped --name social-to-mealie \
  -e OPENAI_URL=https://api.openai.com/v1 \
  -e OPENAI_API_KEY=sk-... \
  -e TRANSCRIPTION_MODEL=whisper-1 \
  -e MEALIE_URL=https://mealie.example.com \
  -e MEALIE_API_KEY=ey... \
  -e MEALIE_GROUP_NAME=home \
  -p 4000:3000 \
  --security-opt no-new-privileges:true \
  ghcr.io/gerardpollorebozado/social-to-mealie:latest
```

</details>

## Environment Variables

| Variable                  | Required | Description                                                                                                                            |
|---------------------------|----------|----------------------------------------------------------------------------------------------------------------------------------------|
| OPENAI_URL                | Yes      | URL for the OpenAI API or a compatible one                                                                                             |
| OPENAI_API_KEY            | Yes      | API key for OpenAI or a compatible one                                                                                                 |
| TRANSCRIPTION_MODEL       | No       | Whisper model to use, required when the local one is not filled                                                                        |
| LOCAL_TRANSCRIPTION_MODEL | No       | Model ID from hugging face to use for local audio to text transcription, required when the provider doesn't support transcriptions API |
| TEXT_MODEL                | Yes      | Text model to use for recipe generation                                                                                                |
| MEALIE_URL                | Yes      | URL of your Mealie instance                                                                                                            |
| MEALIE_API_KEY            | Yes      | API key for Mealie                                                                                                                     |
| MEALIE_GROUP_NAME         | No       | Mealie group name, defaults to "home"                                                                                                  |
| EXTRA_PROMPT              | No       | Additional instructions for AI, such as language translation                                                                           |
| YTDLP_VERSION             | No       | Version of yt-dlp to use, defaults to latest. When set to `latest` the binary is re-downloaded on every container start, so it never goes stale |
| COOKIES                   | No       | Cookies string for yt-dlp to access protected content `NAME=VALUE`                                                                     |
| VAPID_PUBLIC_KEY          | No       | Public VAPID key, enables push notifications when set together with `VAPID_PRIVATE_KEY`                                               |
| VAPID_PRIVATE_KEY         | No       | Private VAPID key, see [Push Notifications](#push-notifications)                                                                       |
| VAPID_SUBJECT             | No       | Contact URI for push notifications (e.g. `mailto:you@example.com`), defaults to a placeholder                                          |
| DATA_DIR                  | No       | Directory used to persist push-notification subscriptions, defaults to `./data`                                                        |

## Push Notifications

When an import is started from the web UI (including the Android "share" flow), it now runs
as a background job on the server, so it finishes even if you switch away from the app or
close it. To get notified when it's done ("Rezept übertragen") or if it failed:

1. Generate a VAPID key pair:
   ```sh
   npx web-push generate-vapid-keys
   ```
2. Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (and optionally `VAPID_SUBJECT`) as
   environment variables for the container, and mount a volume for `DATA_DIR`
   (`/app/data` by default) so subscriptions survive restarts.
3. Open the app, tap **"🔔 Benachrichtigungen aktivieren"**, and allow notifications when
   prompted. You'll get a system notification once a recipe import finishes.

If the VAPID keys aren't set, this button is simply not shown and everything else works as
before — push notifications are entirely optional.

> **Note:** the iOS Shortcut and any other direct API consumer still receive the final
> recipe/error as a synchronous JSON response, unchanged.

## Tested AI providers compatibility:

- OpenAI
- GroqAI
- LiteLLM (by providing the OPENAI_URL of own LiteLLM instance)

## Partial support:
Because theese providers don't support the transcriptions API it requires LOCAL_TRANSCRIPTION_MODEL to be set, recommended model: `Xenova/whisper-base`, you can use any model that is compatible with the ONNX runtime from hugging face
- llmstudio 
- ollama

I can work with any other provider that is compatible with the OpenAI API, if you find any issues please open an issue.
