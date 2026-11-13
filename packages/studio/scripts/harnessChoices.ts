// The design folder is read-only. Apply live data and empty-state sentences to
// the copied JavaScript, keeping the mock's markup and layout as the reference.
export function harnessChoicesSource(path: string, source: string): string {
  const replace = (from: string, to: string) => {
    if (!source.includes(from)) throw new Error(`Harness choices integration no longer matches ${path}`)
    source = source.replace(from, to)
  }
  if (path === 'js/live/git.js') {
    replace('let service;', 'let choicesVersion = 0;\nlet service;')
    replace('Object.keys(HARNESSES).forEach((k) => { delete HARNESSES[k]; });\n  Object.assign(HARNESSES, mapping.mapHarnesses(service.harnesses));', `const generation = ++choicesVersion;
  const current = service, currentAccounts = accounts, currentStatuses = statuses;
  const valid = () => generation === choicesVersion && version === revision && S().session.status === 'in';
  const pendingReport = (harnessId, accountId) => ({ harnessId, accountId, models: { source: 'unavailable', options: [] }, efforts: { source: 'unavailable', options: [] }, reason: 'Reading the models.', effortReason: 'Reading the models.' });
  const accountReports = new Map(currentAccounts.map((a) => [a.id, pendingReport(a.harness, a.id)]));
  Object.keys(HARNESSES).forEach((k) => { delete HARNESSES[k]; });
  Object.assign(HARNESSES, mapping.mapHarnesses(current.harnesses, current.harnesses.map((h) => pendingReport(h.id))));
  const readChoices = async (harnessId, account, model, publish) => {
    try {
      const report = await request('client.harness.choices', { harnessId, ...account });
      if (!valid()) return;
      publish(report); notify();
      if (model && report.models.options.some((m) => m.id === model)) {
        const selected = await request('client.harness.choices', { harnessId, accountId: report.accountId, model });
        if (valid()) { publish(selected); notify(); }
      }
    } catch {
      if (valid()) { publish({ ...pendingReport(harnessId, account.accountId), reason: 'The harness could not report its models on this account.', effortReason: 'The harness could not report its effort choices on this account.' }); notify(); }
    }
  };`)
    replace('engineWrite({ subscriptions: mapping.mapAccounts(accounts, statuses, service.harnesses, service.project) });', 'engineWrite({ subscriptions: mapping.mapAccounts(currentAccounts, currentStatuses, current.harnesses, current.project, [...accountReports.values()]) });')
    replace('subscriptionsLoaded = true; S().ui.serviceReady = true; notify();', `subscriptionsLoaded = true; S().ui.serviceReady = true; notify();
  for (const h of current.harnesses) {
    const lead = current.project?.lead?.harness === h.id ? current.project.lead : undefined;
    const account = lead?.account._tag === 'named' ? { accountId: lead.account.accountId } : {};
    void readChoices(h.id, account, lead?.model || h.defaultModel, (report) => Object.assign(HARNESSES, mapping.mapHarnesses([h], [report])));
  }
  for (const a of currentAccounts) void readChoices(a.harness, { accountId: a.id }, undefined, (report) => {
    accountReports.set(a.id, report);
    engineWrite({ subscriptions: mapping.mapAccounts(currentAccounts, currentStatuses, current.harnesses, current.project, [...accountReports.values()]) });
  });`)

  }
  if (path === 'js/live/board.js') {
    replace('const data = maps().mapSetup(setup.setup, discovery.result, settings.settings);', `const data = maps().mapSetup(setup.setup, discovery.result, settings.settings);
    data.harnessChoices = await Promise.all([...new Set([...discovery.result.harnesses.map((h) => h.harness), ...(data.lead ? [data.lead.harness] : [])])].map(async (harnessId) => {
      const account = data.lead?.harness === harnessId && data.lead.account._tag === 'named' ? { accountId: data.lead.account.accountId } : {};
      const report = await engine.request('client.harness.choices', { harnessId, ...account });
      const model = data.lead?.harness === harnessId ? data.lead.model : undefined;
      return model && report.models.options.some((m) => m.id === model) ? engine.request('client.harness.choices', { harnessId, accountId: report.accountId, model }) : report;
    }));
    data.leadChoices = data.harnessChoices.find((h) => h.harnessId === data.lead?.harness);`)
  }
  if (path === 'js/screens/service.js') {
    replace('const h = HARNESSES[x.harness]; const ags = subAgents(s, x.id);', 'const base = HARNESSES[x.harness]; const h = live.on ? { ...base, models: x.models || [], modelLabels: x.modelLabels, reason: x.reason } : base; const ags = subAgents(s, x.id);')
    for (const start of [`<select class="select" aria-label=\${'Model for new agents on ' + x.name}`, '<select id="gm-model"']) {
      const a = source.indexOf(start), b = source.indexOf('</select>', a) + '</select>'.length
      if (a < 0 || b < '</select>'.length) throw new Error(`Model picker was not found in ${path}`)
      const condition = start.includes('gm-model') ? '!Object.values(HARNESSES).some((h) => h.models.length)' : '!h.models.length'
      const reason = start.includes('gm-model') ? '"No signed-in harness account has reported model choices."' : 'h.reason || "This harness did not report model choices."'
      source = source.slice(0, a) + '${live.on && ' + condition + ' ? html`<span class="muted">${' + reason + '}</span>` : html`' + source.slice(a, b) + '`}' + source.slice(b)
    }
    const start = '<select id="df-model"'
    const end = '</select>'
    const a = source.indexOf(start), b = source.indexOf(end, a) + end.length
    if (a < 0 || b < end.length) throw new Error('Default model picker was not found')
    source = source.slice(0, a) + '${live.on && !h.models.length ? html`<span class="muted">${h.reason || "This harness did not report model choices."}</span>` : html`' + source.slice(a, b).replace('${m}</option>', '${h.modelLabels?.[m] || m}</option>') + '`}' + source.slice(b)
    replace('<${Seg} label="Effort" value=${set.defaultEffort} onChange=${(v) => setS({ defaultEffort: v })} options=${h.efforts.map((e) => ({ id: e, label: e }))} />', '${live.on && !h.efforts.length ? html`<span class="muted">${h.effortReason || "This harness did not report effort choices."}</span>` : html`<${Seg} label="Effort" value=${set.defaultEffort} onChange=${(v) => setS({ defaultEffort: v })} options=${h.efforts.map((e) => ({ id: e, label: h.effortLabels?.[e] || e }))} />`}')
    const leadStart = '<select class="select" aria-label="Lead model"'
    const c = source.indexOf(leadStart), d = source.indexOf('</select>', c) + '</select>'.length
    if (c < 0) throw new Error('Lead model picker was not found')
    source = source.slice(0, c) + '${live.on && !choices?.models?.length ? html`<span class="muted">${choices?.modelReason || "This harness did not report model choices."}</span>` : html`' + source.slice(c, d) + '`}' + source.slice(d)
    replace('No effort setting</span>', '${live.on ? choices?.effortReason || "This harness did not report effort choices." : "No effort setting"}</span>')
  }
  if (path === 'js/screens/auth.js') {
    replace('<select id="setup-git" class="select" onChange=${refuse}><option value=""></option></select>', '${data.harnessChoices?.some((h) => h.models.options.length) ? html`<select id="setup-git" class="select" onChange=${refuse}><option value=""></option>${data.harnessChoices.map((h) => html`<optgroup label=${h.harnessId}>${h.models.options.map((m) => html`<option value=${m.id}>${m.label || m.id}</option>`)}</optgroup>`)}</select>` : html`<p class="muted">${data.leadChoices?.reason || "This harness did not report model choices."}</p>`}')
  }
  if (path === 'js/dialogs.js') {
    replace("The service chooses the lead from its configured defaults.'}</p>", "The service chooses the lead from its configured defaults.'}</p>${s.setupData?.leadChoices?.reason && html`<p class=\"muted\">${s.setupData.leadChoices.reason}</p>`}")
  }
  const replaceAll = (from: string, to: string) => {
    if (!source.includes(from)) throw new Error(`Harness choices integration no longer matches ${path}`)
    source = source.replaceAll(from, to)
  }
  if (path === 'js/ui.js') {
    replaceAll("...(liveMode.on ? a.models || [] : h.models).map", "...(liveMode.on && !a.models?.length ? [{ heading: a.modelReason || 'This harness did not report model choices.' }] : []), ...(liveMode.on ? a.models || [] : h.models).map")
    replaceAll("...(liveMode.on ? a.efforts || [] : h.efforts).map", "...(liveMode.on && !a.efforts?.length ? [{ heading: a.effortReason || 'This harness did not report effort choices.' }] : []), ...(liveMode.on ? a.efforts || [] : h.efforts).map")
  }
  if (path === 'js/screens/messages.js') {
    replaceAll("...(live.on ? a.models || [] : h.models).map", "...(live.on && !a.models?.length ? [{ heading: a.modelReason || 'This harness did not report model choices.' }] : []), ...(live.on ? a.models || [] : h.models).map")
  }
  return source
}
