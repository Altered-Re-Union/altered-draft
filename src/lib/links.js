// External links surfaced in the UI. FEEDBACK_URL is the destination of the menu's
// "Feedback" item — set it to your feedback form/page URL to reveal the item (it's
// hidden while empty).
import { endpoints } from './endpoints.js'

export const FEEDBACK_URL = 'https://forms.gle/uVrbMMGobJ4dzch9A'
// Where the tournaments hub (TournamentMenu.jsx: public lists, "Create a tournament") lives;
// the hub's own pages link back here. /tournament/beta, its address during the beta,
// redirects here (App.jsx).
export const TOURNAMENT_HUB_PATH = '/tournament'
export const REUNION_URL = endpoints().reunionUrl
