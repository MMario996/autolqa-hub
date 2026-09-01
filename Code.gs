// =====================================================================
// AUTOLQA HUB - CORE BACKEND (Code.gs)
// =====================================================================

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('AutoLQA Hub')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =====================================================================
// AUTH & HELPERS
// =====================================================================
function getPhraseToken_() {
  const token = PropertiesService.getScriptProperties().getProperty("PHRASE_API_TOKEN");
  if (!token) throw new Error("Kein Phrase Token in den Script Properties gefunden.");
  return "Bearer " + token.trim();
}

function phraseFetch_(url, options) {
  const defaults = { muteHttpExceptions: true, headers: { 'Authorization': getPhraseToken_(), 'Accept': 'application/json' } };
  const opts = Object.assign(defaults, options || {});
  if (opts.payload && typeof opts.payload === 'object') { opts.payload = JSON.stringify(opts.payload); opts.contentType = 'application/json'; }
  const res = UrlFetchApp.fetch(url, opts);
  if (res.getResponseCode() >= 400) throw new Error("Phrase API " + res.getResponseCode() + ": " + res.getContentText().substring(0, 300));
  return JSON.parse(res.getContentText());
}

// =====================================================================
// GEMINI VIA K?RCHER APIGEE PROXY
// =====================================================================
function getGeminiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key || !key.trim()) throw new Error("Kein GEMINI_API_KEY in den Script Properties gefunden.");
  return key.trim();
}

function geminiGenerate_(model, payload) {
  const key = getGeminiKey_();
  const url = "https://34-111-99-134.nip.io/gemini/v1beta/models/" + model + ":generateContent";
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: { "x-api-key": key, "Accept": "application/json" },
    payload: JSON.stringify(payload)
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code === 429) throw new Error("Rate Limit (429) auf Gemini Apigee Proxy.");
  if (code >= 400) throw new Error("Gemini API Error " + code + ": " + body.substring(0, 300));
  return JSON.parse(body);
}

// =====================================================================
// PHRASE DATA FETCHING
// =====================================================================
function getActiveProjects() {
  try {
    const settingsReq = getAppSettings();
    const settings = settingsReq.settings || getDefaultSettings_();
    let url = "https://cloud.memsource.com/web/api2/v1/projects?pageSize=" + (settings.defaultProjectCount||50) + "&sort=DATE_CREATED&order=DESC";
    if(settings.phraseSourceFilter) url += "&sourceLang=" + encodeURIComponent(settings.phraseSourceFilter);
    if(settings.phraseStatusFilter) url += "&statuses=" + encodeURIComponent(settings.phraseStatusFilter);
    const data = phraseFetch_(url);
    return { success: true, projects: data.content.map(p => ({ id: p.uid, name: p.name, source: p.sourceLang, target: (p.targetLangs || []).join(', '), status: p.status })) };
  } catch (e) { return { success: false, error: e.message }; }
}

function getProjectByUid(projectUid) {
  try {
    const p = phraseFetch_("https://cloud.memsource.com/web/api2/v1/projects/" + projectUid);
    return { success: true, project: { id: p.uid, name: p.name, source: p.sourceLang, target: (p.targetLangs || []).join(', '), status: p.status } };
  } catch (e) { return { success: false, error: e.message }; }
}

function getJobsForProject_(projectUid) {
  const data = phraseFetch_("https://cloud.memsource.com/web/api2/v1/projects/" + projectUid + "/jobs?pageSize=50");
  return (data.content || []).map(j => ({ uid: j.uid, filename: j.filename, targetLang: j.targetLang, status: j.status, wordsCount: j.wordsCount || 0 }));
}

function getTargetLangsForProject(projectUid) {
  try {
    const jobs = getJobsForProject_(projectUid);
    const langs = [...new Set(jobs.map(j => j.targetLang).filter(Boolean))].sort();
    return { success: true, langs: langs };
  } catch (e) { return { success: false, error: e.message }; }
}

/**
 * L?dt ALLE Segmente eines Jobs via Paginierung.
 * Phrase API: beginIndex/endIndex, wobei endIndex=0 alle liefert ? aber bei
 * sehr gro?en Jobs kann das einen Timeout verursachen. Wir paginieren in
 * Bl?cken von SEGMENT_PAGE_SIZE_ um robust zu bleiben.
 */
var SEGMENT_PAGE_SIZE_ = 200;

function getSegmentsForJob_(projectUid, jobUid, begin, end) {
  // Wenn ein explizites end-Limit ?bergeben wird (z.B. f?r max-Segment-Begrenzung)
  if (end && end > 0) {
    const data = phraseFetch_("https://cloud.memsource.com/web/api2/v1/projects/" + projectUid + "/jobs/" + jobUid + "/segments?beginIndex=" + (begin || 0) + "&endIndex=" + end);
    return (data.segments || []).map(s => ({ id: s.id, source: s.source || '', target: s.translation || '' }));
  }
  // Ohne Limit: paginiert laden bis keine mehr kommen
  let allSegs = [];
  let cursor = begin || 0;
  while (true) {
    const chunkEnd = cursor + SEGMENT_PAGE_SIZE_;
    const data = phraseFetch_("https://cloud.memsource.com/web/api2/v1/projects/" + projectUid + "/jobs/" + jobUid + "/segments?beginIndex=" + cursor + "&endIndex=" + chunkEnd);
    const segs = (data.segments || []).map(s => ({ id: s.id, source: s.source || '', target: s.translation || '' }));
    allSegs = allSegs.concat(segs);
    if (segs.length < SEGMENT_PAGE_SIZE_) break; // letzte Seite
    cursor = chunkEnd;
  }
  return allSegs;
}

function getRelevantTermBases_(projectUid) {
  try {
    const data = phraseFetch_("https://cloud.memsource.com/web/api2/v1/projects/" + projectUid + "/termBases/relevant");
    return (Array.isArray(data) ? data : (data.content || data.termBases || [])).map(tb => ({ uid: tb.termBase ? tb.termBase.uid : tb.uid }));
  } catch (e) { return []; }
}

function getAllTermBases() {
  try {
    const data = phraseFetch_("https://cloud.memsource.com/web/api2/v1/termBases?pageSize=50");
    return { success: true, termbases: (data.content || []).map(t => ({ uid: t.uid, name: t.name })) };
  } catch (e) { return { success: false, error: e.message }; }
}

function searchTMByJobV3_(projectUid, jobUid, sourceText, threshold) {
  try {
    const url = `https://cloud.memsource.com/web/api2/v3/projects/${projectUid}/jobs/${jobUid}/transMemories/search`;
    const payload = { query: sourceText, scoreThreshold: threshold || 0.7, maxResults: 3 };
    const data = phraseFetch_(url, { method: 'post', payload: payload });
    if (!data || !data.searchResults) return [];
    return data.searchResults.map(r => ({
      score: r.score || r.grossScore || 0,
      source: r.source ? r.source.text : '',
      target: (r.translations && r.translations.length > 0) ? r.translations[0].text : ''
    }));
  } catch (e) {
    Logger.log("[TM V3 Search Error] " + e.message);
    return [];
  }
}

function resolveTBForSegmentFast_(projectUid, jobUid, sourceText) {
  if (!sourceText || !sourceText.trim()) return [];
  try {
    const url = `https://cloud.memsource.com/web/api2/v2/projects/${projectUid}/jobs/${jobUid}/termBases/searchInTextByJob`;
    const payload = { text: sourceText, reverse: false };
    const data = phraseFetch_(url, { method: 'post', payload: payload });
    const hits = [];
    const seen = new Set();
    if (data && data.searchResults) {
      data.searchResults.forEach(res => {
        const src = (res.sourceTerm && res.sourceTerm.text) ? res.sourceTerm.text : '';
        if (res.translationTerms && res.translationTerms.length > 0) {
          res.translationTerms.forEach(tgt => {
            const trgText = tgt.text;
            const key = src + '|||' + trgText;
            if (!seen.has(key) && src && trgText) {
              seen.add(key);
              hits.push({ sourceTerm: src, targetTerm: trgText });
            }
          });
        }
      });
    }
    return hits;
  } catch (e) {
    Logger.log("[Fast TB Search Error] " + e.message);
    return [];
  }
}

function extractCandidateTerms_(sourceText, minLen, maxNgram) {
  const cleaned = sourceText.replace(/[.,;:!?()"?"'']/g, ' ');
  const words = cleaned.split(/\s+/).filter(w => w.length >= minLen);
  const ngrams = new Set();
  words.forEach(w => ngrams.add(w));
  if(maxNgram >= 2) {
    for (let i = 0; i < words.length - 1; i++) ngrams.add(words[i] + ' ' + words[i + 1]);
  }
  if(maxNgram >= 3) {
    for (let i = 0; i < words.length - 2; i++) ngrams.add(words[i] + ' ' + words[i + 1] + ' ' + words[i + 2]);
  }
  return Array.from(ngrams);
}

function syncIssuesToPhraseTMS(projectUid, issues) {
  try {
    const settingsReq = getAppSettings();
    const settings = settingsReq.settings || getDefaultSettings_();
    let count = 0;
    for (let i = 0; i < issues.length; i++) {
      const iss = issues[i];
      if (!iss.jobUid || !iss.id) continue;
      const commentText = `${settings.commentPrefix} [${iss.severity}] ${iss.category} -> ${iss.subcategory}\n\nKI Begr?ndung: ${iss.explanation}\n\nVorschlag: ${iss.suggestion}`;
      const url = `https://cloud.memsource.com/web/api2/v1/projects/${projectUid}/jobs/${iss.jobUid}/segments/${iss.id}/comments`;
      UrlFetchApp.fetch(url, { method: 'post', headers: { 'Authorization': getPhraseToken_(), 'Content-Type': 'application/json' }, payload: JSON.stringify({ text: commentText }), muteHttpExceptions: true });
      count++;
    }
    logAudit_("Phrase Comment Sync", `Synced ${count} issues as comments to Phrase TMS for project ${projectUid}.`);
    return { success: true, count: count };
  } catch (e) { return { success: false, error: e.message }; }
}

// =====================================================================
// PHRASE LQA ASSESSMENT SYNC
// =====================================================================

function getLqaProfileMapping_(jobUid) {
  try {
    const data = phraseFetch_("https://cloud.memsource.com/web/api2/v1/lqa/assessments/" + jobUid);

    if (!data.lqaEnabled) {
      throw new Error("LQA ist f?r diesen Job nicht aktiviert (lqaEnabled=false). Der Job muss sich in einem LQA Workflow Step befinden.");
    }

    const profile = data.lqaProfile;
    if (!profile || !profile.errorCategories) {
      throw new Error("Kein LQA Profil am Job gefunden.");
    }

    const mapping = {};
    (profile.errorCategories || []).forEach(cat => {
      const catKey = (cat.name || '').toLowerCase().trim();
      const subMap = {};
      (cat.errorSubcategories || []).forEach(sub => {
        subMap[(sub.name || '').toLowerCase().trim()] = sub.id;
      });
      mapping[catKey] = { id: cat.id, subcategories: subMap };
    });

    const severityMap = {};
    (profile.severities || []).forEach(sev => {
      severityMap[(sev.name || '').toLowerCase().trim()] = sev.id;
    });

    Logger.log("[LQA Profile] Loaded. Categories: " + Object.keys(mapping).join(', '));
    Logger.log("[LQA Profile] Severities: " + JSON.stringify(severityMap));

    return { mapping, severityMap, assessmentStatus: data.status, lqaEnabled: data.lqaEnabled };
  } catch (e) {
    Logger.log("[getLqaProfileMapping_] Error: " + e.message);
    throw e;
  }
}

function mapToPhraseLqaIds_(category, subcategory, severity, profileMapping) {
  const { mapping, severityMap } = profileMapping;

  const sevKey = (severity || 'minor').toLowerCase();
  const severityId = severityMap[sevKey] || severityMap['minor'] || Object.values(severityMap)[0];

  const subLower = (subcategory || '').toLowerCase().trim();
  const catLower = (category || '').toLowerCase().trim();

  for (const [catKey, catVal] of Object.entries(mapping)) {
    for (const [subKey, subId] of Object.entries(catVal.subcategories)) {
      if (subKey === subLower) return { errorCategoryId: subId, severityId };
    }
  }
  for (const [catKey, catVal] of Object.entries(mapping)) {
    for (const [subKey, subId] of Object.entries(catVal.subcategories)) {
      if (subKey.includes(subLower) || subLower.includes(subKey)) return { errorCategoryId: subId, severityId };
    }
  }
  for (const [catKey, catVal] of Object.entries(mapping)) {
    if (catKey.includes(catLower) || catLower.includes(catKey)) {
      const firstSubId = Object.values(catVal.subcategories)[0] || catVal.id;
      return { errorCategoryId: firstSubId, severityId };
    }
  }

  const firstCat = Object.values(mapping)[0];
  const fallbackId = firstCat ? (Object.values(firstCat.subcategories)[0] || firstCat.id) : 1;
  Logger.log("[LQA Map] No match for '" + category + " ? " + subcategory + "'. Fallback ID: " + fallbackId);
  return { errorCategoryId: fallbackId, severityId };
}

function syncIssuesToPhraseLQA(projectUid, issues, overallFeedback) {
  try {
    if (!issues || issues.length === 0) return { success: false, error: "Keine Issues zum Synchen." };

    const byJob = {};
    issues.forEach(iss => {
      if (!iss.jobUid) return;
      if (!byJob[iss.jobUid]) byJob[iss.jobUid] = [];
      byJob[iss.jobUid].push(iss);
    });

    let totalSynced = 0, totalErrors = 0;
    const results = [];

    for (const [jobUid, jobIssues] of Object.entries(byJob)) {
      try {
        const profileMapping = getLqaProfileMapping_(jobUid);
        if (!profileMapping.lqaEnabled) {
          results.push({ jobUid, status: 'skipped', reason: 'LQA not enabled' });
          continue;
        }

        Logger.log("[LQA Sync] Starting assessment for job: " + jobUid);
        const startRes = UrlFetchApp.fetch(
          "https://cloud.memsource.com/web/api2/v1/lqa/assessments/" + jobUid,
          {
            method: 'post',
            headers: { 'Authorization': getPhraseToken_(), 'Content-Type': 'application/json', 'Accept': 'application/json' },
            muteHttpExceptions: true,
            payload: JSON.stringify({})
          }
        );
        const startCode = startRes.getResponseCode();
        Logger.log("[LQA Sync] Start assessment response: " + startCode);
        if (startCode >= 400) {
          Logger.log("[LQA Sync] Start error: " + startRes.getContentText().substring(0, 200));
          results.push({ jobUid, status: 'error', reason: 'Could not start assessment: ' + startCode });
          continue;
        }

        let jobSynced = 0;
        for (const iss of jobIssues) {
          try {
            const { errorCategoryId, severityId } = mapToPhraseLqaIds_(
              iss.category, iss.subcategory, iss.severity, profileMapping
            );
            const convUrl = `https://cloud.memsource.com/web/api2/v1/projects/${projectUid}/jobs/${jobUid}/conversations/lqa`;
            const convRes = UrlFetchApp.fetch(convUrl, {
              method: 'post',
              headers: { 'Authorization': getPhraseToken_(), 'Content-Type': 'application/json', 'Accept': 'application/json' },
              muteHttpExceptions: true,
              payload: JSON.stringify({
                references: {
                  segmentId: String(iss.id),
                  transGroupId: 0,
                  lqa: [{ errorCategoryId: errorCategoryId, severityId: severityId }]
                },
                comment: {
                  text: (iss.explanation || '') + (iss.suggestion ? '\n\nSuggestion: ' + iss.suggestion : '')
                }
              })
            });
            const convCode = convRes.getResponseCode();
            if (convCode >= 400) {
              Logger.log("[LQA Sync] Conv error for seg " + iss.id + ": " + convRes.getContentText().substring(0, 200));
              totalErrors++;
            } else {
              jobSynced++;
              totalSynced++;
            }
          } catch (issErr) {
            Logger.log("[LQA Sync] Issue error: " + issErr.message);
            totalErrors++;
          }
        }

        Logger.log("[LQA Sync] Finishing assessment for job: " + jobUid);
        const finishRes = UrlFetchApp.fetch(
          "https://cloud.memsource.com/web/api2/v1/lqa/assessments/" + jobUid + "/scorings",
          {
            method: 'put',
            headers: { 'Authorization': getPhraseToken_(), 'Content-Type': 'application/json', 'Accept': 'application/json' },
            muteHttpExceptions: true,
            payload: JSON.stringify({
              overallFeedback: overallFeedback || ("[AutoLQA] " + jobSynced + " issues synced by AutoLQA Hub.")
            })
          }
        );
        const finishCode = finishRes.getResponseCode();
        Logger.log("[LQA Sync] Finish response: " + finishCode + " | " + finishRes.getContentText().substring(0, 200));
        results.push({ jobUid, status: finishCode < 400 ? 'success' : 'finished_with_error', synced: jobSynced });

      } catch (jobErr) {
        Logger.log("[LQA Sync] Job error for " + jobUid + ": " + jobErr.message);
        results.push({ jobUid, status: 'error', reason: jobErr.message });
        totalErrors++;
      }
    }

    logAudit_("LQA Sync", `Synced ${totalSynced} issues to Phrase LQA for project ${projectUid}. Errors: ${totalErrors}`);
    return { success: true, count: totalSynced, errors: totalErrors, results: results };

  } catch (e) {
    return { success: false, error: e.message };
  }
}

// =====================================================================
// GEMINI AUTO LQA
// =====================================================================
function buildKaercherBrandContext_(settings, contentType) {
  const universal = settings.brandContextUniversal || '';
  let typeSpecific = '';
  if (contentType === 'marketing') typeSpecific = settings.brandContextMarketing || '';
  else if (contentType === 'techdoc') typeSpecific = settings.brandContextTechdoc || '';
  else if (contentType === 'ui') typeSpecific = settings.brandContextUi || '';
  return universal + (typeSpecific ? '\n\n' + typeSpecific : '');
}

function buildLQAPrompt_(profile, projectInfo, enrichedSegments, referenceNotes, strictMode, settings, memory, contentType, batchInfo) {
  const enabledCats = profile.categories.filter(c => c.enabled);
  const catPrompt = enabledCats.map(cat => "- " + cat.name + ": " + cat.subcategories.filter(s => s.enabled).map(s => s.name).join(", ")).join("\n");
  const allowedPairs = [];
  enabledCats.forEach(cat => cat.subcategories.filter(s => s.enabled).forEach(s => allowedPairs.push(cat.name + " ? " + s.name)));
  const sevPrompt = Object.entries(profile.severityPenalties).map(([k, v]) => k + "=" + v + "pts").join(", ");
  const targetLang = (projectInfo.targetLangs || ['unknown'])[0];
  const brandContext = buildKaercherBrandContext_(settings, contentType || 'general');

  const batchBlock = batchInfo ? `\n=== BATCH INFO ===\nDies ist Batch ${batchInfo.current} von ${batchInfo.total} (Segmente ${batchInfo.from}?${batchInfo.to} des Gesamtdokuments). Evaluiere nur diese Segmente.\n` : '';

  const strictBlock = strictMode ? `\n=== ?? STRICT REVIEW MODE (Second Pass) ===\nDer erste Pass hat keine Fehler gefunden. Pr?fe JETZT extra streng auf:\n- Subtile Mistranslations, Nuancen / Under-translation, Awkward Phrasing\n- Inconsistent terminology innerhalb des Sets\n- Register-Mismatches (formell vs. informell), Punctuation/Zeichensetzung\n` : '';

  const memoryBlock = (memory && (memory.rejected.length > 0 || memory.approved.length > 0)) ? `\n=== HISTORICAL MEMORY (RAG) ===\nFALSE POSITIVES (Vom Menschen abgelehnt - ignoriere ?hnliche F?lle):\n${JSON.stringify(memory.rejected)}\n\nTRUE POSITIVES (Vom Menschen best?tigt - lerne dieses Muster):\n${JSON.stringify(memory.approved)}\n` : '';

  return `Du bist ein Senior Linguist und LQA-Reviewer f?r Alfred K?rcher SE & Co. KG. Muttersprachler von "${targetLang}". DQF-MQM Framework.

${brandContext}

=== PROFIL: ${profile.name} ===
${profile.description}

=== MQM-MATRIX ===
${catPrompt}
Erlaubte Paare:
${allowedPairs.join("\n")}

=== SEVERITY PENALTIES ===
${sevPrompt}

=== ROOT CAUSE ANALYSIS ===
- "Pre-translation": Fehler liegt im Original/Source-Text.
- "Production": Fehler wurde bei der ?bersetzung gemacht.

=== TM-RAG-KONTEXT (Translation Memory) ===
1. Bei Score 1.0 (100% Match): ?bersetzung MUSS exakt dem Target entsprechen, sonst "Improper exact TM match".
2. Bei Fuzzy Matches (< 1.0): Pr?fe ob Anpassung sprachlich korrekt ist.

=== PROJEKT ===
${projectInfo.name} | ${projectInfo.sourceLang} ? ${(projectInfo.targetLangs || []).join(', ')}
${profile.promptExtras ? "\n=== PROFIL-HINWEISE ===\n" + profile.promptExtras : ""}
${referenceNotes ? "\n=== STYLEGUIDE NOTES ===\n" + referenceNotes : ""}
${memoryBlock}${strictBlock}${batchBlock}

=== SEGMENTE ===
${JSON.stringify(enrichedSegments)}

WICHTIG: Antworte AUSSCHLIESSLICH in validem JSON. Keine Markdown-Codebl?cke.
Format:
{ "score": [0-100], "passed": [bool], "totalSegments": [n], "errorFreeSegments": [n], "totalWords": [n], "summary": "[Text]", "checkLog": "[Text]",
  "issues": [ { "id": "seg id", "jobUid": "job uid", "file": "name", "category": "Kategorie", "subcategory": "Subkategorie", "severity": "Neutral|Minor|Major|Critical", "weight": 1.0, "penaltyPoints": 1.0, "confidence": [0-100], "source": "Text", "target": "Text", "suggestion": "Text (max 150 Zeichen)", "explanation": "Text (max 200 Zeichen, pr?zise und knapp)", "rootCause": "Pre-translation|Production" } ] }

WICHTIG ZUR L?NGE: Halte "explanation" unter 200 Zeichen und "suggestion" unter 150 Zeichen. Sei pr?zise, nicht ausschweifend.`;
}

function parseLQAJson_(rawText, finishReason) {
  try { return JSON.parse(rawText); } catch(e1) {}
  try { return JSON.parse(rawText.replace(/[\n\r]+/g, " ")); } catch(e2) {}

  Logger.log("[JSON Repair] Versuche Truncation-Reparatur. FinishReason=" + finishReason);
  let repaired = rawText;
  const issuesStart = repaired.indexOf('"issues"');

  if (issuesStart !== -1) {
    const arrStart = repaired.indexOf('[', issuesStart);
    if (arrStart !== -1) {
      let depth = 0;
      let lastGoodEnd = -1;
      let inString = false;
      let escape = false;

      for (let i = arrStart; i < repaired.length; i++) {
        const ch = repaired[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) lastGoodEnd = i;
        }
      }

      if (lastGoodEnd !== -1) {
        const repairedStr = repaired.substring(0, lastGoodEnd + 1) + "]}";
        try {
          const parsed = JSON.parse(repairedStr);
          parsed._truncated = true;
          parsed._repairNote = "Antwort abgeschnitten (finishReason=" + finishReason + ").";
          parsed.summary = "[?? Teilweise repariert] " + (parsed.summary || "");
          return parsed;
        } catch(e3) {
          Logger.log("[JSON Repair] Reparatur fehlgeschlagen: " + e3.message);
        }
      }
    }
  }

  if (finishReason === "MAX_TOKENS") {
    return { score: 0, passed: false, totalSegments: 0, errorFreeSegments: 0, totalWords: 0,
      summary: "[?? SCHWERWIEGEND ABGESCHNITTEN] maxTokens erh?hen oder Batch-Gr??e reduzieren.",
      issues: [], _truncated: true, _severelyTruncated: true };
  }

  throw new Error("KI-Antwort konnte nicht geparst werden (finishReason=" + finishReason +
                  "). Raw-Start: " + rawText.substring(0, 200));
}

function executeLQAPass_(profile, projectInfo, enrichedSegments, referenceNotes, fileObj, strictMode, settings, memory, contentType, batchInfo) {
  const prompt = buildLQAPrompt_(profile, projectInfo, enrichedSegments, referenceNotes, strictMode, settings, memory, contentType, batchInfo);
  const parts = [{ text: prompt }];
  if (fileObj && fileObj.data && fileObj.mime) parts.unshift({ inlineData: { mimeType: fileObj.mime, data: fileObj.data } });

  const payload = {
    contents: [{ parts: parts }],
    generationConfig: { temperature: strictMode ? settings.tempPass2 : settings.tempPass1, responseMimeType: "application/json", maxOutputTokens: settings.maxTokens }
  };

  const modelChain = [settings.primaryModel, "gemini-2.5-flash", "gemini-2.0-flash"];
  let geminiResponse = null; let lastModelError = null; let usedModel = "";

  for (const model of modelChain) {
    try { geminiResponse = geminiGenerate_(model, payload); usedModel = model; break; }
    catch (e) { lastModelError = e; }
  }
  if (!geminiResponse) throw new Error("Alle Modelle haben Limits erreicht. Letzter Fehler: " + (lastModelError ? lastModelError.message : "unbekannt"));

  const candidate = geminiResponse.candidates[0];
  const finishReason = candidate.finishReason || "UNKNOWN";
  Logger.log("[Gemini] Model: " + usedModel + " | Finish: " + finishReason + " | Segments: " + enrichedSegments.length);

  let rawText = candidate.content.parts[0].text;
  rawText = rawText.replace(/^```(json)?\s*/gi, '').replace(/```\s*$/gi, '').trim();

  let lqaResult = parseLQAJson_(rawText, finishReason);
  lqaResult._usedModel = usedModel;
  lqaResult._finishReason = finishReason;
  return lqaResult;
}

// =====================================================================
// BATCH VERARBEITUNG
// Gro?e Dokumente werden in Batches aufgeteilt und die Ergebnisse
// anschlie?end zu einem Gesamt-Report zusammengef?hrt.
// =====================================================================

/**
 * Batch-Gr??e: Anzahl angereicherter Segmente pro Gemini-Call.
 * 30 Segmente = sicher unter Token-Limit auch bei langen Texten.
 * F?r schnelle kleine Dokumente wird kein Batching gebraucht.
 */
var LQA_BATCH_SIZE_ = 30;

/**
 * F?hrt LQA in Batches durch und mergt die Ergebnisse.
 * Gibt ein vollst?ndiges lqaResult-Objekt zur?ck.
 */
function executeLQAInBatches_(profile, projectInfo, enrichedSegments, referenceNotes, fileObj, settings, memory, contentType, updateProgress, progressBase) {
  const totalSegs = enrichedSegments.length;
  const totalBatches = Math.ceil(totalSegs / LQA_BATCH_SIZE_);

  Logger.log("[Batch] " + totalSegs + " Segmente ? " + totalBatches + " Batches ? " + LQA_BATCH_SIZE_);

  let allIssues = [];
  let totalWords = 0;
  let totalErrorFree = 0;
  let summaries = [];
  let usedModel = '';
  let anyTruncated = false;

  for (let b = 0; b < totalBatches; b++) {
    const batchStart = b * LQA_BATCH_SIZE_;
    const batchEnd = Math.min(batchStart + LQA_BATCH_SIZE_, totalSegs);
    const batchSegs = enrichedSegments.slice(batchStart, batchEnd);

    const pct = Math.round(progressBase + ((b / totalBatches) * 40));
    if (updateProgress) updateProgress(`KI-Analyse Batch ${b+1}/${totalBatches} (Seg ${batchStart+1}?${batchEnd})?`, pct);

    Logger.log("[Batch " + (b+1) + "/" + totalBatches + "] Segmente " + batchStart + "?" + batchEnd);

    const batchInfo = { current: b + 1, total: totalBatches, from: batchStart + 1, to: batchEnd };

    try {
      const batchResult = executeLQAPass_(profile, projectInfo, batchSegs, referenceNotes, fileObj, false, settings, memory, contentType, batchInfo);

      allIssues = allIssues.concat(batchResult.issues || []);
      totalWords += parseInt(batchResult.totalWords) || 0;
      totalErrorFree += parseInt(batchResult.errorFreeSegments) || 0;
      if (batchResult.summary && !batchResult.summary.startsWith('[??')) summaries.push(batchResult.summary);
      if (batchResult._truncated) anyTruncated = true;
      if (batchResult._usedModel) usedModel = batchResult._usedModel;

      // Kurze Pause zwischen Batches um Rate Limits zu vermeiden
      if (b < totalBatches - 1) Utilities.sleep(800);

    } catch (batchErr) {
      Logger.log("[Batch " + (b+1) + "] Fehler: " + batchErr.message);
      // Batch-Fehler ?berspringen, nicht abbrechen
    }
  }

  // Score aus Penalty-Summe berechnen
  const totalPenalty = allIssues.reduce((sum, i) => sum + (parseFloat(i.penaltyPoints) || 0), 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));
  const passed = score >= (profile.passThreshold || 99);

  return {
    score: score,
    passed: passed,
    totalSegments: totalSegs,
    errorFreeSegments: totalErrorFree,
    totalWords: totalWords || enrichedSegments.reduce((s, seg) => s + (seg.source || '').split(' ').length, 0),
    summary: anyTruncated
      ? "[?? Teilweise abgeschnitten] " + summaries.join(' | ')
      : summaries.join(' | ') || "Batch-Analyse abgeschlossen.",
    issues: allIssues,
    _usedModel: usedModel,
    _finishReason: anyTruncated ? 'PARTIAL' : 'STOP',
    _batchCount: totalBatches
  };
}

/**
 * Kern-Funktion: F?hrt einen LQA-Durchlauf f?r eine bestimmte Sprache durch.
 * Verwendet Batch-Verarbeitung f?r gro?e Dokumente.
 */
function runLQAForLanguage_(projectUid, projectInfo, lang, jobs, profile, settings, referenceNotes, fileObj, useProjectTB, memory, contentType, updateProgress, segLimit) {
  const langJobs = lang === 'all' ? jobs : jobs.filter(j => j.targetLang === lang);
  if (langJobs.length === 0) throw new Error("Keine Jobs f?r Sprache: " + lang);

  // Segmente laden ? bei segLimit>0 begrenzen, bei 0/"full" alle laden
  const useFullDoc = !segLimit || segLimit === 0 || segLimit === 'full';
  let allSegments = [], totalWordCount = 0;

  for (let i = 0; i < langJobs.length; i++) {
    if (updateProgress) updateProgress(`[${lang}] Lade Segmente Job ${i+1}/${langJobs.length}?`, Math.round(10 + (i / langJobs.length) * 10));
    let segs;
    if (useFullDoc) {
      // Alle Segmente ohne Limit laden (paginiert)
      segs = getSegmentsForJob_(projectUid, langJobs[i].uid, 0, 0);
    } else {
      // Mit Limit
      const remaining = segLimit - allSegments.length;
      if (remaining <= 0) break;
      segs = getSegmentsForJob_(projectUid, langJobs[i].uid, 0, remaining);
    }
    segs.forEach(s => {
      s.jobUid = langJobs[i].uid;
      s.filename = langJobs[i].filename;
      s.targetLang = langJobs[i].targetLang;
    });
    allSegments = allSegments.concat(segs);
    totalWordCount += langJobs[i].wordsCount || 0;
  }

  allSegments = allSegments.filter(s => s.source && s.target && s.source.trim() && s.target.trim());
  if (allSegments.length === 0) throw new Error("Keine ?bersetzten Segmente f?r Sprache: " + lang);

  Logger.log("[LQA] Sprache: " + lang + " | Segmente gesamt: " + allSegments.length);

  // Anreicherung mit TM + TB
  const enrichedSegments = [];
  for (let i = 0; i < allSegments.length; i++) {
    if (updateProgress && i % 10 === 0) updateProgress(`[${lang}] Segment ${i+1}/${allSegments.length} anreichern?`, Math.round(20 + ((i / allSegments.length) * 20)));
    const seg = allSegments[i];
    const tmMatches = searchTMByJobV3_(projectUid, seg.jobUid, seg.source, settings.tmThreshold);
    const tbHits = resolveTBForSegmentFast_(projectUid, seg.jobUid, seg.source);
    enrichedSegments.push({
      id: seg.id, jobUid: seg.jobUid, file: seg.filename, lang: seg.targetLang,
      source: seg.source, target: seg.target,
      tmMatches: tmMatches.map(m => ({ score: m.score, source: m.source, target: m.target })),
      tbHits: tbHits
    });
  }

  const langProjectInfo = Object.assign({}, projectInfo, {
    targetLangs: lang === 'all' ? projectInfo.targetLangs : [lang]
  });

  if (updateProgress) updateProgress(`[${lang}] KI-Analyse startet (${enrichedSegments.length} Segmente in Batches)?`, 45);

  // Batch-Verarbeitung
  let lqaResult = executeLQAInBatches_(profile, langProjectInfo, enrichedSegments, referenceNotes, fileObj, settings, memory, contentType, updateProgress, 45);

  // Double-Pass: nur wenn ein einzelner Batch (kleine Dokumente) und Score hoch
  if (settings.doublePassEnabled && lqaResult._batchCount === 1 &&
      (lqaResult.score >= settings.doublePassThreshold || (lqaResult.issues && lqaResult.issues.length === 0))) {
    if (updateProgress) updateProgress(`[${lang}] Double-Pass (Strict)?`, 88);
    try {
      const strictResult = executeLQAPass_(profile, langProjectInfo, enrichedSegments, referenceNotes, fileObj, true, settings, memory, contentType, null);
      if (strictResult.issues && strictResult.issues.length > 0) {
        lqaResult = strictResult;
        lqaResult.summary = "[Strict Pass] " + (lqaResult.summary || "");
      } else {
        lqaResult.summary = (lqaResult.summary || "") + " (Best?tigt durch Strict Pass.)";
      }
    } catch (e) { Logger.log("Strict Pass error: " + e.message); }
  }

  lqaResult.totalWords = lqaResult.totalWords || totalWordCount;
  return lqaResult;
}

/**
 * Hauptfunktion ? unterst?tzt targetLangFilter und reportMode.
 * segLimit: Zahl = max Segmente, 0 oder 'full' = ganzes Dokument
 */
function runGeminiAutoLQA(projectUid, profileId, referenceNotes, maxSegmentsOverride, fileObj, useProjectTB, taskId, contentType, targetLangFilter, reportMode) {
  const startTime = Date.now();
  const cache = CacheService.getScriptCache();
  const updateProgress = (msg, pct) => {
    if (taskId) { try { cache.put(taskId, JSON.stringify({ message: msg, progress: pct }), 600); } catch(e){} }
  };

  try {
    updateProgress("Initialisiere Projekt & Einstellungen?", 5);
    const settingsReq = getAppSettings();
    const settings = settingsReq.settings || getDefaultSettings_();

    const profilesReq = getLQAProfiles();
    const profiles = profilesReq.profiles || [];
    if (profiles.length === 0) throw new Error("Keine LQA Profile in der Datenbank gefunden.");
    const profile = profiles.find(p => p.id === profileId) || profiles[0];
    if (!profile) throw new Error("Ausgew?hltes Profil konnte nicht geladen werden.");

    Logger.log("[LQA] Content Type: " + (contentType || 'general'));
    Logger.log("[LQA] Target Lang Filter: " + (targetLangFilter || 'all'));
    Logger.log("[LQA] Report Mode: " + (reportMode || 'combined'));
    Logger.log("[LQA] Seg Limit: " + (maxSegmentsOverride || 'full (no limit)'));

    updateProgress("Lade Projektdaten aus Phrase TMS?", 10);
    const projectInfo = phraseFetch_("https://cloud.memsource.com/web/api2/v1/projects/" + projectUid);
    const jobs = getJobsForProject_(projectUid);
    if (jobs.length === 0) throw new Error("Keine Jobs in Phrase gefunden.");

    // maxSegmentsOverride=0 oder nicht gesetzt ? ganzes Dokument
    const segLimit = (maxSegmentsOverride && maxSegmentsOverride > 0) ? maxSegmentsOverride : 0;

    updateProgress("Lade historisches Wissen (RAG Memory)?", 12);
    let memory = { rejected: [], approved: [] };
    if (typeof getMemoryExamples_ === "function") memory = getMemoryExamples_(profile.name);

    const filter = targetLangFilter || 'all';
    const mode = reportMode || 'combined';
    let reports = [];

    if (filter === 'all' && mode === 'per_language') {
      const langs = [...new Set(jobs.map(j => j.targetLang).filter(Boolean))];
      Logger.log("[LQA] Per-language mode. Languages: " + langs.join(', '));

      for (let li = 0; li < langs.length; li++) {
        const lang = langs[li];
        updateProgress(`Verarbeite Sprache ${li+1}/${langs.length}: ${lang}?`, Math.round(15 + (li / langs.length) * 75));
        try {
          const result = runLQAForLanguage_(projectUid, projectInfo, lang, jobs, profile, settings, referenceNotes, fileObj, useProjectTB, memory, contentType, null, segLimit);
          result.reportId = "REP-" + Date.now() + "-" + lang.replace(/[^a-z0-9]/gi, '');
          result.projectUid = projectUid;
          result.projectName = projectInfo.name || projectUid;
          result.profileId = profileId;
          result.profileName = profile.name;
          result.contentType = contentType || 'general';
          result.targetLang = lang;
          result.date = new Date().toISOString().split('T')[0];
          const duration = Date.now() - startTime;
          if (typeof saveReportToDb_ === "function") saveReportToDb_(result, { model: result._usedModel, duration, passes: result._batchCount || 1 });
          reports.push(result);
          Utilities.sleep(500);
        } catch (langErr) {
          Logger.log("[LQA] Error for lang " + lang + ": " + langErr.message);
        }
      }

    } else {
      updateProgress("Segmente extrahieren?", 15);
      const result = runLQAForLanguage_(projectUid, projectInfo, filter, jobs, profile, settings, referenceNotes, fileObj, useProjectTB, memory, contentType, updateProgress, segLimit);
      result.reportId = "REP-" + Date.now();
      result.projectUid = projectUid;
      result.projectName = projectInfo.name || projectUid;
      result.profileId = profileId;
      result.profileName = profile.name;
      result.contentType = contentType || 'general';
      result.targetLang = filter === 'all' ? 'all' : filter;
      result.date = new Date().toISOString().split('T')[0];
      const duration = Date.now() - startTime;
      if (typeof saveReportToDb_ === "function") saveReportToDb_(result, { model: result._usedModel, duration, passes: result._batchCount || 1 });
      reports.push(result);
    }

    if (reports.length === 0) throw new Error("Keine Reports erstellt.");

    if (typeof logAudit_ === "function") logAudit_("AutoLQA Executed", `Project ${projectUid}, Filter: ${filter}, Mode: ${mode}, Reports: ${reports.length}, Batches: ${reports[0]?._batchCount || 1}`);

    updateProgress("Fertig!", 100);
    if (taskId) try { cache.remove(taskId); } catch(e) {}

    return { success: true, reports: reports, report: reports[0] };

  } catch (e) {
    if (taskId) try { cache.remove(taskId); } catch(e) {}
    return { success: false, error: e.message };
  }
}

// =====================================================================
// PROGRESS POLLING
// =====================================================================
function getTaskProgress(taskId) {
  try {
    const cache = CacheService.getScriptCache();
    const data = cache.get(taskId);
    return data ? JSON.parse(data) : null;
  } catch(e) { return null; }
}