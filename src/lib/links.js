// External links surfaced in the UI. FEEDBACK_URL is the destination of the menu's
// "Feedback" item — set it to your feedback form/page URL to reveal the item (it's
// hidden while empty).
import { endpoints } from './endpoints.js'

export const FEEDBACK_URL = 'https://forms.gle/uVrbMMGobJ4dzch9A'
// Where the tournaments hub (TournamentMenu.jsx: public lists, "Create a tournament") lives.
// Beta: hidden here while /tournament keeps the legacy menu (TournamentMenuLegacy.jsx) that
// Home links to, so only testers holding the URL reach the user-created tournaments. The
// unmasking PR moves it back to /tournament and deletes the legacy menu.
export const TOURNAMENT_HUB_PATH = '/tournament/beta'
export const REUNION_URL = endpoints().reunionUrl
