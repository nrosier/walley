const en = {
  label: 'Amount tolerance',
  hint: 'Largest allowed difference between a Wallos amount and an Actual Budget amount, in percent.',
  unit: '%',
  range: 'Enter a value from {min} to {max}.',
  drift: {
    label: 'Currency rate margin',
    hint: 'A foreign-currency pair stays in sync when the converted amounts differ by at most this percentage or 2 minor units of the budget currency (2 cents for EUR), whichever is larger, and only while the Wallos price in its own currency has not changed. 0 turns the margin off, so any difference is a mismatch.',
    range: 'Enter a value from {min} to {max} in steps of {step}.',
  },
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
  drift: {
    label: 'Marge wisselkoers',
    hint: 'Een koppeling in vreemde valuta blijft synchroon zolang de omgerekende bedragen maximaal dit percentage of 2 kleinste eenheden van de budgetvaluta (2 cent voor EUR) verschillen, het grootste van de twee, en alleen zolang de Wallos-prijs in de eigen valuta niet is gewijzigd. Met 0 staat de marge uit, dus elk verschil is een afwijking.',
    range: 'Voer een waarde in van {min} tot {max} in stappen van {step}.',
  },
  save: 'Koppeling opslaan',
  status: {
    saving: 'Opslaan...',
    saved: 'Opgeslagen',
  },
};

export const matchingSettingsMessages = { en, nl };
