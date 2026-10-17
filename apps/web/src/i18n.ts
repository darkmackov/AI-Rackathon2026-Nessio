import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { documentsCs, documentsEn } from './components/documents/translations'
import { handoverEditCs, handoverEditEn } from './components/handover/translations'
import { workflowCs, workflowEn } from './components/workflow/translations'
import { caseDetailCs, caseDetailEn } from './screens/CaseDetail/translations'
import { referralCs, referralEn } from './screens/Referral/translations'
import { mdtCs, mdtEn } from './screens/CaseDetail/Mdt/translations'
import { messagesCs, messagesEn } from './components/messages/translations'
import { s8Cs, s8En } from './screens/CaseDetail/S8/translations'
import { fhirExportCs, fhirExportEn } from './components/fhir/translations'

export const resources = {
  cs: { translation: {
    s8: s8Cs,
    fhirExport: fhirExportCs,
    messages: messagesCs,
    mdt: mdtCs,
    workflow: workflowCs,
    caseDetail: caseDetailCs,
    referral: referralCs,
    documents: documentsCs,
    handoverEdit: handoverEditCs,
    appName: 'Nessio', skip: 'Přejít k obsahu', navigation: 'Hlavní navigace',
    language: 'Jazyk', demoData: 'Demo s fiktivními daty', realApi: 'Režim skutečného API', userMenu: 'Uživatel {{name}}', contactsOf: 'Kontakty: {{name}}', address: 'Adresa', changeLanguage: 'Změnit jazyk', referrerWelcome: 'Vítejte, {{name}}',
    selectTitle: 'Vyberte svou identitu', selectIntro: 'Zvolte roli a osobu, za kterou chcete pracovat.',
    role: 'Role', person: 'Osoba', choosePerson: 'Vyberte osobu', continue: 'Pokračovat',
    referring_doctor: 'Odesílající lékař', coordinator: 'Koordinátor KOC',
    changeIdentity: 'Změnit osobu', workplace: 'Pracoviště', phone: 'Telefon', email: 'E-mail',
    unavailable: 'Není uvedeno',
    dashboardTitle: 'Pracovní fronta koordinátora', dashboardDescription: 'Přehled případů vašeho KOC. Vyberte pacienta pro zobrazení podkladů a dalšího kroku.',
    loading: 'Načítám…', retry: 'Zkusit znovu', errorTitle: 'Data se nepodařilo načíst',
    errorNetwork: 'Spojení s API se nezdařilo. Ověřte připojení a zkuste to znovu.',
    error400: 'Požadavek obsahuje neplatné údaje. Zkontrolujte je a zkuste to znovu.',
    error403: 'Tato osoba nemá oprávnění k požadované akci.',
    error404: 'Požadované údaje nebyly nalezeny. Zvolte jinou osobu nebo akci opakujte.',
    error409: 'Akci nelze provést v aktuálním stavu. Obnovte data a zkuste to znovu.',
    error422: 'Zkontrolujte zadané údaje. Některá hodnota není platná.',
    error501: 'Tato funkce zatím není implementována.',
    errorOther: 'Při zpracování požadavku nastala chyba. Zkuste to znovu.',
    emptyDirectory: 'Pro tuto roli nejsou dostupné žádné osoby. Zvolte jinou roli nebo obnovte číselník.',
    missingOrganization: 'Pracoviště se nepodařilo dohledat. Obnovte číselník nebo zvolte jinou osobu.',
    emptyCases: 'Vaše KOC zatím nemá žádné případy.', emptyCasesHint: 'Pro ukázku přepněte na koordinátora Nemocnice Lipová nebo v panelu Demo obnovte referenční scénář.',
    emptyColumn: 'V této skupině nejsou žádné případy.',
    state: 'Stav', owner: 'Na tahu', nextStep: 'Další krok', nextDue: 'Termín', priority: 'Priorita',
    queue: { novy: 'Nový pacient', aktivni: 'Aktivní pacient', odlozeny: 'Odložený pacient' },
    states: { koncept: 'Koncept', odeslano: 'Odesláno', v_triage: 'V triage', ceka_na_podklady: 'Čeká na podklady', kompletni: 'Kompletní', pripraveno_k_mdt: 'Připraveno k MDT', zaver_mdt: 'Závěr KOC / MDT', zpetna_vazba_odeslana: 'Zpětná vazba odeslána', uzavreno: 'Uzavřeno', vraceno_lekari: 'Vráceno lékaři' },
    priorities: { normal: 'Běžná', high: 'Vysoká', urgent: 'Urgentní' },
    demo: 'Demo', demoTitle: 'Ovládání dema', close: 'Zavřít', simulated: 'Simulovaný čas', wallClock: 'Skutečný čas',
    currentTime: 'Aktuální čas aplikace', clockError: 'Čas aplikace se nepodařilo načíst.', computerTime: 'Časová zóna tohoto počítače: {{zone}}. Nastavený čas dále běží.',
    dateTime: 'Datum a čas', applyTime: 'Nastavit čas', wallClockAction: 'Použít skutečný čas',
    invalidDateTime: 'Zadejte platné místní datum a čas.', validationTitle: 'Zkontrolujte formulář',
    timeSaved: 'Čas aplikace byl změněn.', resetSaved: 'Demo bylo obnoveno.',
    resetHeading: 'Obnovení dat', scenario: 'Scénář', referenceScenario: 'Reference před MDT', emptyScenario: 'Prázdné demo',
    resetReference: 'Obnovit referenci', resetEmpty: 'Obnovit prázdné demo',
    confirmReset: 'Obnovit demo?', confirmResetText: 'Smažou se změny v aktuálním demu a obnoví se scénář „{{scenario}}“ i jeho čas. Vybraná osoba a jazyk zůstanou.',
    resetConfirm: 'Obnovit data', cancel: 'Zrušit', resetHelp: 'Změny platí pouze v této kartě prohlížeče. Obnovení stránky vrátí výchozí referenci a češtinu a vyžádá nový výběr osoby.',
    notFound: 'Stránka nebyla nalezena', notFoundDescription: 'Tato adresa v aplikaci neexistuje.', home: 'Přejít na úvod',
  } },
  en: { translation: {
    s8: s8En,
    fhirExport: fhirExportEn,
    messages: messagesEn,
    mdt: mdtEn,
    workflow: workflowEn,
    caseDetail: caseDetailEn,
    referral: referralEn,
    documents: documentsEn,
    handoverEdit: handoverEditEn,
    appName: 'Nessio', skip: 'Skip to content', navigation: 'Main navigation',
    language: 'Language', demoData: 'Demo with fictional data', realApi: 'Real API mode', userMenu: 'User {{name}}', contactsOf: 'Contacts: {{name}}', address: 'Address', changeLanguage: 'Change language', referrerWelcome: 'Welcome, {{name}}',
    selectTitle: 'Choose your identity', selectIntro: 'Choose the role and person you want to work as.',
    role: 'Role', person: 'Person', choosePerson: 'Choose a person', continue: 'Continue',
    referring_doctor: 'Referring doctor', coordinator: 'KOC coordinator',
    changeIdentity: 'Change person', workplace: 'Organisation', phone: 'Phone', email: 'Email',
    unavailable: 'Not provided',
    dashboardTitle: 'Coordinator work queue', dashboardDescription: 'Cases at your KOC. Select a patient to view their documents and next step.',
    loading: 'Loading…', retry: 'Try again', errorTitle: 'Could not load the data',
    errorNetwork: 'Could not connect to the API. Check your connection and try again.',
    error400: 'The request contains invalid data. Check the values and try again.',
    error403: 'This person is not allowed to perform this action.',
    error404: 'The requested data was not found. Choose another person or try again.',
    error409: 'This action is unavailable in the current state. Reload the data and try again.',
    error422: 'Check the entered data. A value is invalid.',
    error501: 'This feature has not been implemented yet.',
    errorOther: 'The request could not be processed. Please try again.',
    emptyDirectory: 'No people are available for this role. Choose another role or reload the directory.',
    missingOrganization: 'The organisation could not be found. Reload the directory or choose another person.',
    emptyCases: 'There are no cases at your KOC yet.', emptyCasesHint: 'For a preview, choose the Lipová hospital coordinator or restore the reference scenario in Demo.',
    emptyColumn: 'There are no cases in this group.',
    state: 'State', owner: 'On the move', nextStep: 'Next step', nextDue: 'Due', priority: 'Priority',
    queue: { novy: 'New patient', aktivni: 'Active patient', odlozeny: 'On hold' },
    states: { koncept: 'Draft', odeslano: 'Sent', v_triage: 'In triage', ceka_na_podklady: 'Waiting for documents', kompletni: 'Complete', pripraveno_k_mdt: 'Ready for MDT', zaver_mdt: 'KOC / MDT conclusion', zpetna_vazba_odeslana: 'Feedback sent', uzavreno: 'Closed', vraceno_lekari: 'Returned to GP' },
    priorities: { normal: 'Normal', high: 'High', urgent: 'Urgent' },
    demo: 'Demo', demoTitle: 'Demo controls', close: 'Close', simulated: 'Simulated time', wallClock: 'Real time',
    currentTime: 'Current app time', clockError: 'Could not load the app time.', computerTime: 'Time zone of this computer: {{zone}}. The selected time continues to run.',
    dateTime: 'Date and time', applyTime: 'Set time', wallClockAction: 'Use real time',
    invalidDateTime: 'Enter a valid local date and time.', validationTitle: 'Check the form',
    timeSaved: 'The app time has been changed.', resetSaved: 'The demo has been restored.',
    resetHeading: 'Restore data', scenario: 'Scenario', referenceScenario: 'Reference before MDT', emptyScenario: 'Empty demo',
    resetReference: 'Restore reference', resetEmpty: 'Restore empty demo',
    confirmReset: 'Restore the demo?', confirmResetText: 'Changes in this demo will be deleted and the “{{scenario}}” scenario and its time will be restored. The selected person and language will stay the same.',
    resetConfirm: 'Restore data', cancel: 'Cancel', resetHelp: 'Changes apply only to this browser tab. Reloading restores the reference scenario and Czech language and requires choosing a person again.',
    notFound: 'Page not found', notFoundDescription: 'This address does not exist in the app.', home: 'Go to home',
  } },
}

export function createI18n() {
  const instance = i18next.createInstance()
  void instance.use(initReactI18next).init({
    resources, lng: 'cs', fallbackLng: 'cs', initAsync: false,
    interpolation: { escapeValue: false },
  })
  return instance
}

export const i18n = createI18n()

export async function changeLanguage(language: 'cs' | 'en') {
  await i18n.changeLanguage(language)
  document.documentElement.lang = language
  document.title = i18n.t('appName')
}
