const en = {
  label: 'Amount tolerance',
  hint: 'Largest allowed difference between a Wallos amount and an Actual Budget amount, in percent.',
  unit: '%',
  range: 'Enter a value from {min} to {max}.',
  save: 'Save Matching',
  status: {
    saving: 'Saving...',
    saved: 'Saved',
  },
};

const nl: typeof en = {
  label: 'Toegestane afwijking bedrag',
  hint: 'Grootste toegestane verschil tussen een bedrag in Wallos en een bedrag in Actual Budget, in procent.',
  unit: '%',
  range: 'Voer een waarde in van {min} tot {max}.',
  save: 'Koppeling opslaan',
  status: {
    saving: 'Opslaan...',
    saved: 'Opgeslagen',
  },
};

export const matchingSettingsMessages = { en, nl };
