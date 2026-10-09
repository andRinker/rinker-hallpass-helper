# Notes for Claude

## Testing the extension in a cloud browser

`.mcp.json` starts the Chrome DevTools MCP server with the cloud's Chromium (`/opt/pw-browsers/chromium`) and loads `hallpass-helper/` unpacked at startup.

- The bundled Chromium is too old for the `install_extension` and `list_extensions` tools, so the extension is loaded with `--load-extension` instead.
- Its ID comes from the folder's absolute path. Get it with:
  `node -e "const h=require('crypto').createHash('sha256').update(require('path').resolve('hallpass-helper')).digest('hex').slice(0,32);console.log([...h].map(c=>String.fromCharCode(97+parseInt(c,16))).join(''))"`
- Open the side panel as a tab with `navigate_page` to `chrome-extension://<id>/sidepanel/sidepanel.html`; options are at `/options/options.html`.
- The cloud browser can't sign in to the real HallPass. Real-page testing happens on Andrew's laptop, with the side panel's "Copy HallPass page outline" pasted back.
