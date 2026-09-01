// =====================================================================
// AUTOLQA HUB - SETTINGS LOGIC
// =====================================================================

const DEFAULT_KAERCHER_PROMPTS_ = {
  universal: `*** BRAND CONTEXT: K?RCHER (UNIVERSELL) ***
Du evaluierst Content f?r Alfred K?rcher SE & Co. KG, einen deutschen Weltmarktf?hrer f?r Reinigungstechnik mit globaler Brand Language.

HARTE REGELN (keine Ausnahmen):
1. Der Markenname "K?rcher" wird IMMER mit Umlaut geschrieben. "Karcher" oder "Kaercher" sind Fehler (Severity: Critical), AUSSER in URLs, Dateinamen, E-Mail-Adressen oder technischen IDs.
2. Produktnamen mit Leerzeichen wie "K 2", "K 3", "K 4", "K 5", "K 7", "HDS 5/11", "HD 6/13" bleiben STRUKTURELL unver?ndert. Das Leerzeichen zwischen Buchstabe und Zahl ist Teil der offiziellen Schreibweise und darf NICHT entfernt werden.
3. "K?rcher" ist ein Eigenname und darf niemals als Verb oder Gattungsbegriff verwendet werden.
4. Gesch?ftsbereichs-Bezeichnungen "Home & Garden" und "Professional" sind offizielle K?rcher-Termini und werden meist un?bersetzt gelassen, au?er die Termbase gibt etwas anderes vor.

*** TERMBASE-AUTORIT?T (GROUND TRUTH) ***
Jedes Segment enth?lt ein "tbHits" Feld mit Termbase-Matches aus Phrase TMS. Diese tbHits sind die GROUND TRUTH f?r K?rcher-Terminologie in dieser Sprache.
- Wenn im Target ein Term vorkommt, der einem tbHit.targetTerm entspricht ? KORREKT, egal wie ungew?hnlich er klingt. Kein Issue melden.
- Wenn im Source ein tbHit.sourceTerm vorkommt, aber im Target NICHT der zugeh?rige tbHit.targetTerm ? Das ist ein "Inconsistent with termbase" Fehler (Major oder Critical).
- Wenn KEIN tbHit existiert und du einen Term nur "intuitiv" f?r falsch h?ltst ? sei vorsichtig. Falls unsicher: NICHT MELDEN.

*** UNSICHERHEITS-REGEL ***
Wenn du dir bei einem potenziellen Fehler nicht sicher bist (Confidence unter 70):
- MELDE IHN NICHT.
- Es ist besser, einen echten Fehler zu ?bersehen, als einen bewussten Brand- oder Stil-Choice als Fehler zu markieren.
- Ausnahme: Eindeutige harte Fehler (Rechtschreibung, Grammatik, Zahlen, Produktnamen, Placeholder) meldest du auch bei moderater Unsicherheit.`,

  marketing: `*** CONTENT TYPE: MARKETING / WEB / BRAND ***
Dieser Text ist Marketing-Content und folgt K?rcher's etablierter Brand Language auf kaercher.com und in offiziellen Marketing-Materialien.

WICHTIGE HALTUNG:
- K?rcher-Marketing hat eine eigene, teils bewusst markante Sprache. Markiere Formulierungen NICHT als "unidiomatic", "awkward" oder "non-native", nur weil sie emotionaler, kraftvoller oder ungew?hnlicher klingen als generischer Flie?text. Marketing DARF und SOLL sich von neutralem Text abheben.
- Superlative, Emotionalit?t und kraftvolle Verben sind erw?nscht, nicht fehlerhaft.
- Wenn du unsicher bist, ob eine Formulierung ein Fehler oder bewusste Brand Language ist: MELDE SIE NICHT. Lieber einen echten Fehler ?bersehen als einen bewussten Brand-Choice als Fehler markieren.
- Einzige Ausnahme: eindeutige Grammatikfehler, Rechtschreibfehler oder echte Mistranslations, die den Sinn verf?lschen ? die werden immer gemeldet.

TONALIT?T:
- Aktiv, direkt, l?sungsorientiert
- Kundenansprache je nach Zielsprache angemessen (Du/Sie in DE, vouvoiement in FR formal, etc.)
- Keine Floskeln, keine Schachtels?tze`,

  techdoc: `*** CONTENT TYPE: TECHNISCHE DOKUMENTATION ***
Dieser Text ist Teil einer Bedienungsanleitung, einer technischen Spezifikation oder eines Sicherheitsdokuments.

STRIKTE REGELN:
- Terminologie muss EXAKT konsistent sein. Jede Abweichung von der Termbase ist ein Major-Fehler, nicht Minor.
- Sicherheitshinweise (WARNUNG, ACHTUNG, GEFAHR, VORSICHT) folgen ISO-Normen und m?ssen in der Zielsprache exakt den etablierten Termini entsprechen.
- Handlungsanweisungen m?ssen im Imperativ oder in der vom Styleguide definierten Form stehen.
- KEIN Marketing-Ton, KEINE Emotionalit?t, KEINE Vereinfachungen, die technische Pr?zision opfern.
- Numerische Werte, Einheiten (bar, ?C, l/h, kW) und Produktnamen sind IMMER exakt zu ?bernehmen. Abweichungen = Critical.
- Im Zweifel: Strenger bewerten als bei Marketing-Content.`,

  ui: `*** CONTENT TYPE: UI / SOFTWARE ***
Dieser Text erscheint in einer App, einem Display, einer Weboberfl?che oder einer Software.

REGELN:
- K?rze ist Pflicht. Buttons, Labels und Men?-Eintr?ge m?ssen knapp sein. Wenn die ?bersetzung deutlich l?nger als die Source ist und dadurch UI-Truncation droht, ist das ein Fehler (Kategorie: Design ? Length, Severity: Major).
- Imperativ f?r Buttons: "Speichern", "Save", "Enregistrer" ? nicht "Das Dokument speichern".
- Keine Satzzeichen am Ende von Button-Labels, au?er Ellipsen bei Dialog-?ffnenden Aktionen ("Speichern unter?").
- Platzhalter wie {0}, %s, {{name}} m?ssen strukturell 1:1 ?bernommen werden. Abweichung = Critical.
- Terminologie-Konsistenz ist in UI besonders kritisch: derselbe Source-String muss durchgehend gleich ?bersetzt sein.`
};

function getDefaultSettings_() {
  return {
    defaultTbUid: "", phraseSourceFilter: "", phraseStatusFilter: "", defaultProjectCount: 50,
    phraseMaxSegments: 30, tmThreshold: 0.7, tbLookupLimit: 15, tbMinWordLength: 3, tbMaxNgram: 3,
    lqaDefaultProfile: "mqm_core_standard", primaryModel: "gemini-2.5-pro",
    tempPass1: 0.1, tempPass2: 0.05, maxTokens: 32768, doublePassThreshold: 100, doublePassEnabled: true,
    commentPrefix: "[AutoLQA]", autoSyncConfidence: 0, notificationEmail: "", webhookUrl: "",
    uiTheme: "light", uiLang: "de", uiDefaultView: "projects",
    roiHourlyRate: 50, roiWordsPerHour: 2500,
    brandContextUniversal: DEFAULT_KAERCHER_PROMPTS_.universal,
    brandContextMarketing: DEFAULT_KAERCHER_PROMPTS_.marketing,
    brandContextTechdoc: DEFAULT_KAERCHER_PROMPTS_.techdoc,
    brandContextUi: DEFAULT_KAERCHER_PROMPTS_.ui
  };
}

// =====================================================================
// ESCAPE / UNESCAPE HELPERS
// Verhindert, dass Google Sheets lange Prompt-Texte als Formel wertet.
// Sheets interpretiert Zellen-Inhalte, die mit =, +, -, @, *, # beginnen,
// als Formeln ? #ERROR!. Wir escapen mit einem f?hrenden Apostroph.
// Beim Lesen gibt Sheets den Wert OHNE das Apostroph zur?ck, daher
// brauchen wir beim Lesen KEINEN manuellen Strip ? das macht Sheets selbst.
// Die einzige Ausnahme: falls der Wert als String aus getValues() mit einem
// echten f?hrenden Apostroph zur?ckkommt (passiert in seltenen Edge-Cases),
// wird er hier sauber entfernt.
// =====================================================================

function escapeSheetValue_(val) {
  if (typeof val !== 'string') return val;
  // Alle Zeichen, die Sheets als Formel-Trigger interpretieren kann
  if (val.startsWith('=') ||
      val.startsWith('+') ||
      val.startsWith('-') ||
      val.startsWith('@') ||
      val.startsWith('*') ||
      val.startsWith('#')) {
    return "'" + val;
  }
  return val;
}

function unescapeSheetValue_(val) {
  // getValues() gibt den Apostroph normalerweise NICHT zur?ck,
  // aber zur Sicherheit pr?fen wir es trotzdem.
  if (typeof val === 'string' && val.startsWith("'") && val.length > 1) {
    // Nur entfernen wenn das zweite Zeichen eines der Trigger-Zeichen ist,
    // damit wir keine echten Werte, die mit Apostroph beginnen, kaputt machen.
    const second = val.charAt(1);
    if (second === '=' || second === '+' || second === '-' ||
        second === '@' || second === '*' || second === '#') {
      return val.substring(1);
    }
  }
  return val;
}

// =====================================================================
// SETTINGS LESEN
// =====================================================================

function getAppSettings() {
  try {
    const ss = getDbSheet_();
    const sheet = ss.getSheetByName("Settings");
    const data = sheet.getDataRange().getValues();
    let settings = getDefaultSettings_();

    for (let i = 1; i < data.length; i++) {
      const key = data[i][0];
      if (!key) continue;
      let val = data[i][1];
      val = unescapeSheetValue_(String(val === null || val === undefined ? '' : val));
      // Leere Strings nicht ?ber Default schreiben, au?er der Default ist auch ein String
      if (val === '' && typeof settings[key] !== 'string') continue;
      settings[key] = val;
    }

    // Typkonvertierungen
    settings.phraseMaxSegments   = parseInt(settings.phraseMaxSegments)   || 30;
    settings.defaultProjectCount = parseInt(settings.defaultProjectCount) || 50;
    settings.tmThreshold         = parseFloat(settings.tmThreshold)       || 0.7;
    settings.tbLookupLimit       = parseInt(settings.tbLookupLimit)       || 15;
    settings.tbMinWordLength     = parseInt(settings.tbMinWordLength)      || 3;
    settings.tbMaxNgram          = parseInt(settings.tbMaxNgram)           || 3;
    settings.tempPass1           = parseFloat(settings.tempPass1)          || 0.1;
    settings.tempPass2           = parseFloat(settings.tempPass2)          || 0.05;
    settings.maxTokens           = parseInt(settings.maxTokens)            || 32768;
    settings.doublePassThreshold = parseFloat(settings.doublePassThreshold)|| 100;
    settings.doublePassEnabled   = settings.doublePassEnabled === "true" || settings.doublePassEnabled === true;
    settings.autoSyncConfidence  = parseInt(settings.autoSyncConfidence)   || 0;
    settings.roiHourlyRate       = parseFloat(settings.roiHourlyRate)      || 50;
    settings.roiWordsPerHour     = parseInt(settings.roiWordsPerHour)      || 2500;

    // Brand Context Fallback auf Default, falls leer oder fehlend
    if (!settings.brandContextUniversal || settings.brandContextUniversal.trim() === '')
      settings.brandContextUniversal = DEFAULT_KAERCHER_PROMPTS_.universal;
    if (!settings.brandContextMarketing || settings.brandContextMarketing.trim() === '')
      settings.brandContextMarketing = DEFAULT_KAERCHER_PROMPTS_.marketing;
    if (!settings.brandContextTechdoc || settings.brandContextTechdoc.trim() === '')
      settings.brandContextTechdoc = DEFAULT_KAERCHER_PROMPTS_.techdoc;
    if (!settings.brandContextUi || settings.brandContextUi.trim() === '')
      settings.brandContextUi = DEFAULT_KAERCHER_PROMPTS_.ui;

    return { success: true, settings: settings };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// =====================================================================
// SETTINGS SCHREIBEN (intern)
// =====================================================================

function saveAppSettings_internal(settings, ssObj) {
  const ss = ssObj || getDbSheet_();
  const sheet = ss.getSheetByName("Settings");
  sheet.clearContents();
  sheet.appendRow(["Key", "Value"]);

  Object.keys(settings).forEach(k => {
    const raw = settings[k];
    const val = escapeSheetValue_(raw === null || raw === undefined ? '' : String(raw));
    sheet.appendRow([k, val]);
  });
}

// =====================================================================
// SETTINGS SCHREIBEN (?ffentlich, aus UI aufgerufen)
// =====================================================================

function saveAppSettings(settings) {
  try {
    saveAppSettings_internal(settings);
    logAudit_("Settings Updated", "User updated global settings via UI.");
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// =====================================================================
// K?RCHER BRAND CONTEXT PROMPTS ZUR?CKSETZEN
// =====================================================================

function resetKaercherPrompts() {
  try {
    const res = getAppSettings();
    if (!res.success) return { success: false, error: res.error };
    const settings = res.settings;
    settings.brandContextUniversal = DEFAULT_KAERCHER_PROMPTS_.universal;
    settings.brandContextMarketing = DEFAULT_KAERCHER_PROMPTS_.marketing;
    settings.brandContextTechdoc   = DEFAULT_KAERCHER_PROMPTS_.techdoc;
    settings.brandContextUi        = DEFAULT_KAERCHER_PROMPTS_.ui;
    saveAppSettings_internal(settings);
    logAudit_("Kaercher Prompts Reset", "Brand Context Prompts wurden auf Default zur?ckgesetzt.");
    return { success: true, settings: settings };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// =====================================================================
// DEBUG & MIGRATION HELPERS
// =====================================================================

function debugMaxTokens() {
  const res = getAppSettings();
  Logger.log("Current maxTokens: " + res.settings.maxTokens);
  Logger.log("Type: " + typeof res.settings.maxTokens);
}

function forceMaxTokensUpdate() {
  const res = getAppSettings();
  res.settings.maxTokens = 32768;
  saveAppSettings(res.settings);
  Logger.log("Done. Neuer Wert: " + res.settings.maxTokens);
}

function migrateBrandContextSettings() {
  const res = getAppSettings();
  if (!res.success) { Logger.log("Fehler: " + res.error); return; }
  saveAppSettings_internal(res.settings);
  Logger.log("Migration abgeschlossen. Brand Context Keys sind jetzt im Sheet.");
  Logger.log("Universal length: "  + (res.settings.brandContextUniversal || '').length);
  Logger.log("Marketing length: "  + (res.settings.brandContextMarketing || '').length);
  Logger.log("Techdoc length: "    + (res.settings.brandContextTechdoc   || '').length);
  Logger.log("UI length: "         + (res.settings.brandContextUi        || '').length);
}

/**
 * Einmalig aufrufen, um alle bestehenden Settings neu zu schreiben
 * und dabei die Escape-Logik anzuwenden. Behebt nachtr?glich alle
 * bestehenden #ERROR!-Eintr?ge im Sheet.
 */
function repairSettingsSheet() {
  try {
    const res = getAppSettings();
    if (!res.success) { Logger.log("Fehler beim Lesen: " + res.error); return; }
    saveAppSettings_internal(res.settings);
    Logger.log("Settings Sheet repariert. Alle Werte neu geschrieben mit Escape-Logik.");
  } catch (e) {
    Logger.log("Fehler bei repairSettingsSheet: " + e.message);
  }
}