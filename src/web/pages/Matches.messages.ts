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
  },
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
  },
};

export const matchesMessages = { en, nl };
