const en = {
  title: 'Review differences',
  description: '{wallos} (Wallos) and {actual} (Actual Budget) no longer agree.',
  field: 'Field',
  wallos: 'Wallos',
  actual: 'Actual Budget',
  none: 'None',
  every: 'Every {n}',
  frequencies: {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    yearly: 'Yearly',
  },
  working: 'Working...',
  options: 'Choose what to do',
  consequence: {
    ignoreDiff: 'Keeps both items as they are and stops flagging this difference.',
    overwriteWallos: 'Changes the subscription in Wallos to match Actual Budget.',
    overwriteActual: 'Changes the schedule in Actual Budget to match Wallos.',
    unlink: 'Walley stops tracking these two as a pair. Nothing changes in Wallos or Actual Budget.',
  },
  fields: {
    amount: 'Amount',
    currency: 'Currency',
    frequency: 'Frequency',
    interval: 'Interval',
    startDate: 'Start date',
  },
  table: 'Drifted fields',
  overwriteWallos: 'Overwrite Wallos',
  overwriteActual: 'Overwrite Actual',
  ignoreDiff: 'Ignore Diff',
  unlink: 'Unlink',
  overwriteWallosConfirmTitle: 'Overwrite Wallos with the Actual Budget values?',
  overwriteActualConfirmTitle: 'Overwrite Actual Budget with the Wallos values?',
  overwriteConfirmBody: 'This changes data in the other system and cannot be undone from Walley.',
  unlinkConfirmTitle: 'Unlink this pair?',
  unlinkConfirmBody: 'The subscription and the schedule stay where they are, but Walley stops tracking them as a pair.',
  confirm: 'Confirm',
  cancel: 'Cancel',
  failed: 'Could not update {name}.',
  overwriteErrors: {
    confirmation_required: 'The overwrite was not confirmed. Confirm it and try again.',
    invalid_state: 'These items no longer differ. Run the sync check again.',
    overwrite_unverified: 'The change could not be verified, so nothing was overwritten. Run the sync check again.',
    range_amount_unsupported: 'An amount range cannot be written to Wallos, so nothing was overwritten.',
    patterns_unsupported: 'This recurrence pattern cannot be converted, so nothing was overwritten.',
    match_not_found: 'This pair no longer exists. Run the sync check again.',
    no_change_needed: 'Nothing needed to be written, so nothing was changed. The pair is still marked as different.',
  },
};

const nl: typeof en = {
  title: 'Verschillen bekijken',
  description: '{wallos} (Wallos) en {actual} (Actual Budget) komen niet meer overeen.',
  field: 'Veld',
  wallos: 'Wallos',
  actual: 'Actual Budget',
  none: 'Geen',
  every: 'Elke {n}',
  frequencies: {
    daily: 'Dagelijks',
    weekly: 'Wekelijks',
    monthly: 'Maandelijks',
    yearly: 'Jaarlijks',
  },
  working: 'Bezig...',
  options: 'Kies wat u wilt doen',
  consequence: {
    ignoreDiff: 'Laat beide items zoals ze zijn en meldt dit verschil niet meer.',
    overwriteWallos: 'Past het abonnement in Wallos aan zodat het overeenkomt met Actual Budget.',
    overwriteActual: 'Past het schema in Actual Budget aan zodat het overeenkomt met Wallos.',
    unlink: 'Walley houdt deze twee niet meer bij als paar. In Wallos en Actual Budget verandert niets.',
  },
  fields: {
    amount: 'Bedrag',
    currency: 'Valuta',
    frequency: 'Frequentie',
    interval: 'Interval',
    startDate: 'Startdatum',
  },
  table: 'Afwijkende velden',
  overwriteWallos: 'Wallos overschrijven',
  overwriteActual: 'Actual overschrijven',
  ignoreDiff: 'Verschil negeren',
  unlink: 'Ontkoppelen',
  overwriteWallosConfirmTitle: 'Wallos overschrijven met de waarden uit Actual Budget?',
  overwriteActualConfirmTitle: 'Actual Budget overschrijven met de waarden uit Wallos?',
  overwriteConfirmBody: 'Hiermee wijzig je gegevens in het andere systeem. Dit kan niet vanuit Walley ongedaan worden gemaakt.',
  unlinkConfirmTitle: 'Dit paar ontkoppelen?',
  unlinkConfirmBody: 'Het abonnement en het schema blijven bestaan, maar Walley houdt ze niet meer bij als paar.',
  confirm: 'Bevestigen',
  cancel: 'Annuleren',
  failed: '{name} kon niet worden bijgewerkt.',
  overwriteErrors: {
    confirmation_required: 'Het overschrijven is niet bevestigd. Bevestig het en probeer opnieuw.',
    invalid_state: 'Deze items verschillen niet meer. Voer de synchronisatiecontrole opnieuw uit.',
    overwrite_unverified: 'De wijziging kon niet worden gecontroleerd, dus er is niets overschreven. Voer de synchronisatiecontrole opnieuw uit.',
    range_amount_unsupported: 'Een bedragenbereik kan niet naar Wallos worden geschreven, dus er is niets overschreven.',
    patterns_unsupported: 'Dit herhalingspatroon kan niet worden omgezet, dus er is niets overschreven.',
    match_not_found: 'Dit paar bestaat niet meer. Voer de synchronisatiecontrole opnieuw uit.',
    no_change_needed: 'Er hoefde niets te worden geschreven, dus er is niets gewijzigd. Het paar staat nog als afwijkend gemarkeerd.',
  },
};

export const diffModalMessages = { en, nl };

export const OVERWRITE_ERROR_CODES = [
  'confirmation_required',
  'invalid_state',
  'overwrite_unverified',
  'range_amount_unsupported',
  'patterns_unsupported',
  'match_not_found',
  'no_change_needed',
] as const;

export type OverwriteErrorCode = (typeof OVERWRITE_ERROR_CODES)[number];

export function isOverwriteErrorCode(code: string): code is OverwriteErrorCode {
  return (OVERWRITE_ERROR_CODES as readonly string[]).includes(code);
}
