const en = {
  title: 'Wallos',
  fields: {
    url: 'Wallos URL',
    apiKey: 'Wallos API key',
  },
  apiKeySaved: '•••••••• saved',
  help: 'Test Connection uses your saved settings. Save first.',
  actions: {
    save: 'Save',
    saving: 'Saving...',
    test: 'Test Connection',
    testing: 'Testing...',
  },
  status: {
    saved: 'Saved.',
    saveFailed: 'Could not save settings.',
    loadFailed: 'Could not load settings.',
    testOk: 'Connection OK.',
    testFailed: 'Connection test failed.',
  },
};

const nl: typeof en = {
  title: 'Wallos',
  fields: {
    url: 'Wallos-URL',
    apiKey: 'Wallos-API-sleutel',
  },
  apiKeySaved: '•••••••• opgeslagen',
  help: 'Verbinding testen gebruikt uw opgeslagen instellingen. Sla eerst op.',
  actions: {
    save: 'Opslaan',
    saving: 'Opslaan...',
    test: 'Verbinding testen',
    testing: 'Testen...',
  },
  status: {
    saved: 'Opgeslagen.',
    saveFailed: 'Instellingen konden niet worden opgeslagen.',
    loadFailed: 'Instellingen konden niet worden geladen.',
    testOk: 'Verbinding OK.',
    testFailed: 'Verbindingstest mislukt.',
  },
};

export const wallosSettingsMessages = { en, nl };
