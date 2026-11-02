const en = {
  loading: 'Loading the details...',
  loadFailed: 'The details could not be loaded.',
  notSet: 'Not set',
  yes: 'Yes',
  no: 'No',
  wallosHeading: 'Wallos subscription',
  actualHeading: 'Actual Budget schedule',
  wallos: {
    price: 'Price',
    currency: 'Currency',
    cycle: 'Billing cycle',
    startDate: 'Start date',
    nextPayment: 'Next payment',
    paymentMethod: 'Payment method',
    category: 'Category',
    notes: 'Notes',
    autoRenew: 'Auto-renew',
  },
  actual: {
    amount: 'Amount',
    currency: 'Currency',
    frequency: 'Frequency',
    startDate: 'Start date',
    payee: 'Payee',
    account: 'Account',
  },
  /** Opens the details dialog from the item name of a synced row. */
  openDetails: 'Show details for {name}',
};

const nl: typeof en = {
  loading: 'Gegevens laden...',
  loadFailed: 'De gegevens konden niet worden geladen.',
  notSet: 'Niet ingesteld',
  yes: 'Ja',
  no: 'Nee',
  wallosHeading: 'Wallos-abonnement',
  actualHeading: 'Actual Budget-schema',
  wallos: {
    price: 'Prijs',
    currency: 'Valuta',
    cycle: 'Factureringscyclus',
    startDate: 'Startdatum',
    nextPayment: 'Volgende betaling',
    paymentMethod: 'Betaalmethode',
    category: 'Categorie',
    notes: 'Notities',
    autoRenew: 'Automatisch verlengen',
  },
  actual: {
    amount: 'Bedrag',
    currency: 'Valuta',
    frequency: 'Frequentie',
    startDate: 'Startdatum',
    payee: 'Begunstigde',
    account: 'Rekening',
  },
  openDetails: 'Details tonen voor {name}',
};

export const syncItemDetailsMessages = { en, nl };
