const en = {
  title: 'Matches',
  table: {
    label: 'Linked subscriptions',
    wallos: 'Wallos subscription',
    actual: 'Actual Budget schedule',
    wallosAmount: 'Wallos amount',
    actualAmount: 'Actual amount',
    status: 'Status',
  },
  range: 'range',
  rangeHint: 'Amount is the midpoint of a range',
  empty: 'No linked pairs yet. Run Sync Check on the Sync Dashboard to load them.',
  ignored: {
    toggle: 'Show ignored items',
    title: 'Ignored items',
    name: 'Item',
    side: 'Side',
    sides: {
      wallos: 'Wallos',
      actual: 'Actual Budget',
    },
    amount: 'Amount',
    none: 'No ignored items.',
    actions: 'Action',
    restore: 'Restore',
    restoreLabel: 'Restore (unignore)',
    failed: 'Could not restore {name}.',
  },
  review: 'Review',
  reviewLabel: 'Review differences',
};

const nl: typeof en = {
  title: 'Koppelingen',
  table: {
    label: 'Gekoppelde abonnementen',
    wallos: 'Wallos-abonnement',
    actual: 'Actual Budget-schema',
    wallosAmount: 'Wallos-bedrag',
    actualAmount: 'Actual-bedrag',
    status: 'Status',
  },
  range: 'bereik',
  rangeHint: 'Het bedrag is het midden van een bereik',
  empty: 'Nog geen gekoppelde paren. Start de synchronisatiecontrole op het Synchronisatie-dashboard om ze te laden.',
  ignored: {
    toggle: 'Genegeerde items tonen',
    title: 'Genegeerde items',
    name: 'Item',
    side: 'Kant',
    sides: {
      wallos: 'Wallos',
      actual: 'Actual Budget',
    },
    amount: 'Bedrag',
    none: 'Geen genegeerde items.',
    actions: 'Actie',
    restore: 'Herstellen',
    restoreLabel: 'Herstellen (negeren ongedaan maken)',
    failed: '{name} kon niet worden hersteld.',
  },
  review: 'Bekijken',
  reviewLabel: 'Verschillen bekijken',
};

export const matchesMessages = { en, nl };
