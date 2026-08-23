(function () {
  const API_BASE = 'http://127.0.0.1:8787/api';

  const banner = document.getElementById('mailerBanner');
  const contactForm = document.getElementById('contactForm');
  const contactName = document.getElementById('contactName');
  const contactEmail = document.getElementById('contactEmail');
  const contactList = document.getElementById('contactList');
  const contactEmpty = document.getElementById('contactEmpty');

  const groupForm = document.getElementById('groupForm');
  const groupName = document.getElementById('groupName');
  const groupNewMembers = document.getElementById('groupNewMembers');
  const groupNewEmpty = document.getElementById('groupNewEmpty');
  const groupList = document.getElementById('groupList');
  const groupEmpty = document.getElementById('groupEmpty');

  const sendGroup = document.getElementById('sendGroup');
  const sendSubject = document.getElementById('sendSubject');
  const sendBody = document.getElementById('sendBody');
  const sendBtn = document.getElementById('sendBtn');
  const sendStatus = document.getElementById('sendStatus');

  let contacts = [];
  let groups = [];

  async function api(path, options) {
    const res = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  }

  function contactsById(ids) {
    return contacts.filter((c) => ids.includes(c.id));
  }

  function renderContacts() {
    contactList.innerHTML = '';
    contactEmpty.hidden = contacts.length > 0;
    for (const c of contacts) {
      const row = document.createElement('div');
      row.className = 'mailer-item';
      row.innerHTML = `
        <div class="mailer-item-main">
          <div class="mailer-item-name"></div>
          <div class="mailer-item-sub"></div>
        </div>
        <button type="button" class="mailer-item-del" aria-label="Delete contact">&#10005;</button>
      `;
      row.querySelector('.mailer-item-name').textContent = c.name;
      row.querySelector('.mailer-item-sub').textContent = c.email;
      row.querySelector('.mailer-item-del').addEventListener('click', () => deleteContact(c.id));
      contactList.appendChild(row);
    }
  }

  function renderGroupNewMembers() {
    groupNewMembers.innerHTML = '';
    groupNewEmpty.hidden = contacts.length > 0;
    for (const c of contacts) {
      const label = document.createElement('label');
      label.className = 'mailer-checkbox-pill';
      label.innerHTML = `<input type="checkbox" value="${c.id}"> <span></span>`;
      label.querySelector('span').textContent = c.name;
      groupNewMembers.appendChild(label);
    }
  }

  function renderGroups() {
    groupList.innerHTML = '';
    groupEmpty.hidden = groups.length > 0;
    for (const g of groups) {
      const details = document.createElement('details');
      details.className = 'panel collapsible-panel';
      details.style.padding = '4px 16px';

      const summary = document.createElement('summary');
      const memberCount = g.contactIds.length;
      summary.innerHTML = `
        <div class="mailer-group-header" style="flex:1;">
          <span></span>
          <button type="button" class="mailer-item-del" aria-label="Delete group">&#10005;</button>
        </div>
      `;
      summary.querySelector('span').textContent = `${g.name} (${memberCount})`;
      summary.querySelector('.mailer-item-del').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteGroup(g.id);
      });

      const body = document.createElement('div');
      body.className = 'collapsible-body';
      const grid = document.createElement('div');
      grid.className = 'mailer-checkbox-grid';
      if (contacts.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'mailer-empty';
        empty.textContent = 'No contacts to add yet.';
        body.appendChild(empty);
      } else {
        for (const c of contacts) {
          const label = document.createElement('label');
          label.className = 'mailer-checkbox-pill';
          const checked = g.contactIds.includes(c.id) ? 'checked' : '';
          label.innerHTML = `<input type="checkbox" value="${c.id}" ${checked}> <span></span>`;
          label.querySelector('span').textContent = c.name;
          label.querySelector('input').addEventListener('change', () => toggleGroupMember(g, c.id));
          grid.appendChild(label);
        }
        body.appendChild(grid);
      }

      details.appendChild(summary);
      details.appendChild(body);
      groupList.appendChild(details);
    }
  }

  function renderSendGroupOptions() {
    const previous = sendGroup.value;
    sendGroup.innerHTML = '';
    if (groups.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'No groups yet';
      opt.value = '';
      sendGroup.appendChild(opt);
      sendGroup.disabled = true;
      return;
    }
    sendGroup.disabled = false;
    for (const g of groups) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `${g.name} (${g.contactIds.length})`;
      sendGroup.appendChild(opt);
    }
    if ([...sendGroup.options].some((o) => o.value === previous)) {
      sendGroup.value = previous;
    }
  }

  function renderAll() {
    renderContacts();
    renderGroupNewMembers();
    renderGroups();
    renderSendGroupOptions();
  }

  async function loadAll() {
    [contacts, groups] = await Promise.all([api('/contacts'), api('/groups')]);
    renderAll();
  }

  async function addContact(e) {
    e.preventDefault();
    try {
      await api('/contacts', {
        method: 'POST',
        body: JSON.stringify({ name: contactName.value.trim(), email: contactEmail.value.trim() }),
      });
      contactForm.reset();
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteContact(id) {
    if (!confirm('Delete this contact?')) return;
    try {
      await api(`/contacts/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  async function createGroup(e) {
    e.preventDefault();
    const contactIds = [...groupNewMembers.querySelectorAll('input:checked')].map((el) => el.value);
    try {
      await api('/groups', {
        method: 'POST',
        body: JSON.stringify({ name: groupName.value.trim(), contactIds }),
      });
      groupForm.reset();
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  async function toggleGroupMember(group, contactId) {
    const contactIds = group.contactIds.includes(contactId)
      ? group.contactIds.filter((id) => id !== contactId)
      : [...group.contactIds, contactId];
    try {
      await api(`/groups/${group.id}`, {
        method: 'PUT',
        body: JSON.stringify({ contactIds }),
      });
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteGroup(id) {
    if (!confirm('Delete this group?')) return;
    try {
      await api(`/groups/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  async function sendEmail() {
    sendStatus.textContent = '';
    sendStatus.className = 'mailer-status';
    const groupId = sendGroup.value;
    const subject = sendSubject.value.trim();
    const body = sendBody.value;
    if (!groupId) return;
    if (!subject) {
      sendStatus.textContent = 'Add a title first.';
      sendStatus.className = 'mailer-status error';
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    try {
      const result = await api('/send', {
        method: 'POST',
        body: JSON.stringify({ groupId, subject, body }),
      });
      const failedCount = result.failed.length;
      if (failedCount === 0) {
        sendStatus.textContent = `Sent to ${result.sent.length} contact${result.sent.length === 1 ? '' : 's'}.`;
        sendStatus.className = 'mailer-status success';
        sendSubject.value = '';
        sendBody.value = '';
      } else {
        sendStatus.textContent = `Sent to ${result.sent.length}, failed for ${failedCount}: ${result.failed.map((f) => f.email).join(', ')}`;
        sendStatus.className = 'mailer-status error';
      }
    } catch (err) {
      sendStatus.textContent = err.message;
      sendStatus.className = 'mailer-status error';
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send email';
    }
  }

  contactForm.addEventListener('submit', addContact);
  groupForm.addEventListener('submit', createGroup);
  sendBtn.addEventListener('click', sendEmail);

  api('/health')
    .then(() => loadAll())
    .catch(() => { banner.classList.add('visible'); });
})();
