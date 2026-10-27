const en = {
  title: 'Link to another item',
  description: '{name} lost its partner in {side}. Pick an unlinked item in {side} to link it to.',
  sides: {
    wallos: 'Wallos',
    actual: 'Actual Budget',
  },
  options: 'Unlinked items',
  option: '{name} ({amount})',
  optionNoAmount: '{name}',
  suggested: 'Suggested: {label}',
  none: 'No unlinked items are available on this side.',
  submit: 'Link',
  linking: 'Linking...',
  cancel: 'Cancel',
  failed: 'Could not link. {reason} (code: {code})',
};

const nl: typeof en = {
  title: 'Koppelen aan een ander item',
  description: '{name} heeft zijn tegenhanger in {side} verloren. Kies een ongekoppeld item in {side} om aan te koppelen.',
  sides: {
    wallos: 'Wallos',
    actual: 'Actual Budget',
  },
  options: 'Ongekoppelde items',
  option: '{name} ({amount})',
  optionNoAmount: '{name}',
  suggested: 'Voorgesteld: {label}',
  none: 'Aan deze kant zijn geen ongekoppelde items beschikbaar.',
  submit: 'Koppelen',
  linking: 'Koppelen...',
  cancel: 'Annuleren',
  failed: 'Koppelen is mislukt. {reason} (code: {code})',
};

export const relinkDialogMessages = { en, nl };
