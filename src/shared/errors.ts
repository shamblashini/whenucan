/**
 * Every message the API can send, in English. The API sends the key with the English text,
 * and the browser shows its own translation of that key.
 */
export const ERRORS = {
  "error.rateLimited": "Too many requests. Wait a minute and try again.",
  "error.notConfigured": "This site is not fully set up yet.",
  "error.badOrigin": "This request came from another site.",
  "error.notFound": "Not found.",
  "error.botMissing": "Bot check missing. Reload the page and try again.",
  "error.botUnavailable": "The bot check is unavailable. Try again in a moment.",
  "error.botRejected": "The bot check did not pass. Reload the page and try again.",
  "error.signIn": "Sign in to continue.",
  "error.googleNotConfigured": "Google sign-in is not set up yet.",
  "error.lastDayBeforeFirst": "The last day must not be before the first day.",
  "error.rangeTooLong": "Pick a date range of one year or less.",
  "error.linkDead": "This link does not work any more.",
  "error.notOwner": "Only the organiser can do that.",
  "error.enterName": "Enter your name to continue.",
  "error.removed": "You were removed from this group. Enter your name to rejoin.",
  "error.groupsPerDay": "You can create {count} groups a day. Try again tomorrow.",
  "error.groupsTotal": "You have {count} groups. Delete an old one first.",
  "error.groupFull": "This group is full: it has {count} people.",
  "error.joiningBusy": "Many people are joining right now. Try again in a few minutes.",
  "error.dayOutside": "That day is outside this group's dates.",
  "error.endAfterStart": "The end time must be after the start time.",
  "error.proposalTooLong": "A proposal can last {count} days at most.",
  "error.timeOutside": "Pick a time inside this group's dates.",
  "error.proposalsGroupLimit": "This group has reached its limit of proposals.",
  "error.proposalsPersonLimit": "You can add {count} proposals to a group.",
  "error.proposalDuplicate": "That proposal is already on the list.",
  "error.proposalRemoved": "That proposal was removed.",
  "error.proposalAlreadyRemoved": "That proposal was already removed.",
  "error.notCreator": "Only the person who proposed it can remove it.",
  "error.checkInput": "Check your input.",
  "error.invalidJson": "Send a valid JSON body.",
  "error.server": "Something failed on the server. Try again.",
  "error.invalidDate": "Use a valid date.",
  "error.groupName": "Give the group a name.",
  "error.invalidTimezone": "Choose a valid time zone.",
  "error.nameRequired": "Enter your name.",
  "error.invalidStart": "Enter a valid start time.",
  "error.invalidEnd": "Enter a valid end time.",
} as const;

export type ErrorKey = keyof typeof ERRORS;
export type ErrorVars = Record<string, string | number>;

export function errorText(key: ErrorKey, vars?: ErrorVars): string {
  return ERRORS[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
}

export function isErrorKey(value: unknown): value is ErrorKey {
  return typeof value === "string" && Object.hasOwn(ERRORS, value);
}
