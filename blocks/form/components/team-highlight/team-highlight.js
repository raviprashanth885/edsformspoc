// Shows a popup with a real, live-fetched next-game summary for whichever
// team the visitor picks (see localize-worker's /api/team-highlight
// endpoint - real ESPN data, nothing here is authored or invented). No
// outbound link - the popup ends with an upsell line pointed at finishing
// the signup instead of sending the visitor to read an article mid-form.
// Requires browsing through the local Worker proxy - if that endpoint isn't
// reachable (e.g. viewing the form directly against aem up), this fails
// silently rather than showing broken or fabricated content.

function closePopup(popup) {
  popup.classList.remove('open');
}

function renderPopup(popup, data) {
  popup.innerHTML = '';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'team-highlight-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => closePopup(popup));

  popup.append(closeBtn);

  if (data.logo) {
    const banner = document.createElement('img');
    banner.className = 'team-highlight-banner';
    banner.src = data.logo;
    banner.alt = data.team;
    popup.append(banner);
  }

  const body = document.createElement('div');
  body.className = 'team-highlight-body';

  const heading = document.createElement('h3');
  heading.textContent = data.team;

  const message = document.createElement('p');
  message.className = 'team-highlight-message';
  message.textContent = data.message;

  body.append(heading, message);

  if (data.event) {
    const event = document.createElement('p');
    event.className = 'team-highlight-event';
    // ESPN returns "Team A at Team B" (home/away) - "vs" reads more
    // naturally for a fan-facing popup; the teams/date are unchanged.
    const matchup = data.event.name.replace(/ at /i, ' vs ');
    event.textContent = `Next game: ${matchup} — ${new Date(data.event.date).toDateString()}`;
    body.append(event);
  }

  const upsell = document.createElement('p');
  upsell.className = 'team-highlight-upsell';
  upsell.textContent = "Finish signing up and we'll send your game-day alert before kickoff.";
  body.append(upsell);

  popup.append(body);
  popup.classList.add('open');
}

function renderLoading(popup) {
  popup.innerHTML = '';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'team-highlight-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => closePopup(popup));

  const body = document.createElement('div');
  body.className = 'team-highlight-body team-highlight-loading';
  body.textContent = 'Loading...';

  popup.append(closeBtn, body);
  popup.classList.add('open');
}

function getActiveLanguage() {
  // dataset.currentLang (not .value) tracks the language of the form as it's
  // actually rendered right now - decorateLanguageSwitcher() in form.js only
  // sets it once a switch's translated form has finished loading and been
  // swapped in, so this can't report a pending selection whose translation
  // hasn't landed yet.
  const select = document.querySelector('.language-switcher-select');
  return select?.dataset.currentLang || 'en';
}

export default function decorate(fieldDiv) {
  const select = fieldDiv.querySelector('select');
  if (!select) return fieldDiv;

  // The whole form (including this field) is re-rendered from scratch on
  // every language switch (see decorateLanguageSwitcher() in form.js) -
  // without this, each switch would leave the previous render's popup
  // orphaned in document.body instead of replacing it.
  document.querySelectorAll('.team-highlight-popup').forEach((el) => el.remove());

  const popup = document.createElement('div');
  popup.className = 'team-highlight-popup';
  document.body.append(popup);

  select.addEventListener('change', async () => {
    const { value } = select;
    if (!value || value === 'none') {
      closePopup(popup);
      return;
    }
    const lang = getActiveLanguage();
    const params = new URLSearchParams({ team: value });
    if (lang !== 'en') params.set('lang', lang);
    // Show a loading state immediately - a fresh team/language combo can
    // take several seconds (longer if a form translation is also in
    // flight, since both features share one local LLM that only serves
    // one request at a time), and a silent wait reads as broken.
    renderLoading(popup);
    try {
      const res = await fetch(`/api/team-highlight?${params}`);
      // If the user picked a different team while this was in flight, drop
      // this stale response instead of overwriting the newer one.
      if (select.value !== value) return;
      if (!res.ok) return;
      const data = await res.json();
      renderPopup(popup, data);
    } catch (err) {
      // Worker not reachable (e.g. viewing the form directly against aem up
      // instead of through the localize-worker proxy) - fail silently
      // rather than showing broken or fabricated content.
      // eslint-disable-next-line no-console
      console.log('team-highlight unavailable:', err.message);
      closePopup(popup);
    }
  });

  return fieldDiv;
}
