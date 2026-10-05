(function () {
  'use strict';
  const escape = value => escapeHtml(String(value == null ? '' : value));
  function validPhone(value) {
    const body = String(value || '').trim().replace(/(?:extension|ext\.?|x|#)\s*\d{1,6}$/i, '').trim();
    const digits = body.replace(/\D/g, '');
    return /^[+0-9().\s-]+$/.test(body) && digits.length >= 10 && digits.length <= 15;
  }
  function accountCell(account, link, available) {
    if (!available) return '<span class="small">Contacts unavailable. Refresh to retry.</span>';
    const linked = link && link.contact_id;
    const label = linked ? (link.contact_status === 'former' ? 'Archived employee Contact' : link.contact_active ? 'Linked to Contacts' : 'Linked · hidden from directory') : link && link.candidates && link.candidates.length ? 'Existing Contact needs review' : link && link.add_to_contacts ? 'Requested · awaiting approval' : 'Not linked';
    return `<div class="account-contact-cell"><span class="jgc-badge ${linked ? 'jgc-badge--success' : 'jgc-badge--warning'}">${escape(label)}</span><button type="button" class="jgc-button jgc-button--secondary" onclick="openEmployeeContactDetails('${escape(account.id)}',${!linked})">${linked ? 'Edit contact details' : 'Add to Contacts'}</button></div>`;
  }
  async function loadLinks(client) {
    const result = await client.rpc('get_employee_contact_links');
    if (result.error) throw result.error;
    return new Map((Array.isArray(result.data) ? result.data : []).map(item => [item.profile_id, item]));
  }
  function edit(settings) {
    let dialog = document.getElementById('employeeContactDialog');
    if (dialog) dialog.remove();
    const account = settings.account, link = settings.link || {}, linked = !!link.contact_id;
    if (!account) return;
    dialog = document.createElement('dialog');
    dialog.id = 'employeeContactDialog';
    dialog.className = 'employee-contact-dialog jgc-panel';
    dialog.setAttribute('aria-labelledby', 'employeeContactTitle');
    const candidates = link.candidates || [], needsReview = candidates.length > 1 || candidates.some(item => item.match_quality !== 'strong');
    const choices = candidates.map(item => `<option value="${escape(item.contact_id)}" ${item.linked_profile_id && item.linked_profile_id !== account.id ? 'disabled' : ''}>${escape(item.name)} · ${escape((item.reasons || []).join(', '))}${item.linked_profile_id && item.linked_profile_id !== account.id ? ' · already linked' : ''}</option>`).join('');
    const fallbackPhone = candidates.length === 1 && candidates[0].match_quality === 'strong' ? candidates[0].phone : '';
    dialog.innerHTML = `<form id="employeeContactForm" class="jgc-form-grid">
      <div class="employee-contact-wide"><h2 id="employeeContactTitle">Employee Contact Details</h2><p class="small">Name, phone and email are saved to the employee account and automatically update its linked Contact. Contact notes, descriptions and display order stay in Contacts.</p></div>
      <div class="jgc-field employee-contact-wide"><label class="jgc-label" for="employeeContactName">Full Name</label><input id="employeeContactName" class="jgc-input" autocomplete="name" maxlength="80" minlength="2" required value="${escape(account.display_name)}"></div>
      <div class="jgc-field"><label class="jgc-label" for="employeeContactPhone">Phone Number</label><input id="employeeContactPhone" class="jgc-input" type="tel" autocomplete="tel" maxlength="40" required value="${escape(account.phone || fallbackPhone)}"></div>
      <div class="jgc-field"><label class="jgc-label" for="employeeContactEmail">Email Address</label><input id="employeeContactEmail" class="jgc-input" type="email" autocomplete="email" maxlength="254" required value="${escape(account.email)}"></div>
      <label class="jgc-label employee-contact-wide employee-contact-check"><input id="employeeContactEnabled" type="checkbox" ${linked || settings.addToContacts || link.add_to_contacts ? 'checked' : ''} ${linked ? 'disabled' : ''}> Add to Contacts</label>
      <div id="employeeContactMatch" class="employee-contact-wide" ${candidates.length ? '' : 'hidden'}>
        <p class="jgc-notice">${needsReview ? 'Review these possible matches before linking. A new duplicate Contact will not be created.' : 'The existing matching Contact will be linked. Its notes and other directory details are retained.'}</p>
        <label class="jgc-label" for="employeeContactCandidate">Existing Contact</label><select id="employeeContactCandidate" class="jgc-select">${needsReview ? '<option value="">Choose the correct Contact</option>' : ''}${choices}</select>
        ${needsReview ? '<label class="jgc-label employee-contact-check"><input id="employeeContactConfirm" type="checkbox"> I confirm this Contact is the same employee.</label>' : ''}
      </div>
      <p class="small employee-contact-wide">${linked ? 'Linked employees are hidden automatically when their account becomes inactive or gets Limited Access. Archive or restore directory visibility from Contacts.' : account.account_status === 'approved' ? 'The Contact becomes visible in the active directory after linking.' : 'The Contact remains hidden until the employee account is approved.'}</p>
      <p id="employeeContactSaveStatus" class="jgc-notice employee-contact-wide" role="status" aria-live="polite"></p>
      <div class="jgc-actions employee-contact-wide"><button type="submit" class="jgc-button" id="employeeContactSave">Save details</button><button type="button" class="jgc-button jgc-button--secondary" id="employeeContactCancel">Cancel</button></div>
    </form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector('form'), enabled = dialog.querySelector('#employeeContactEnabled'), matches = dialog.querySelector('#employeeContactMatch');
    enabled.addEventListener('change', () => { matches.hidden = !enabled.checked || !candidates.length; });
    matches.hidden = !enabled.checked || !candidates.length;
    dialog.querySelector('#employeeContactCancel').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const status = dialog.querySelector('#employeeContactSaveStatus'), button = dialog.querySelector('#employeeContactSave');
      if (button.disabled || !form.reportValidity()) return;
      const phone = dialog.querySelector('#employeeContactPhone').value.trim();
      if (!validPhone(phone)) { status.textContent = 'Enter a valid phone number, including its area code.'; return; }
      const candidate = dialog.querySelector('#employeeContactCandidate'), confirm = dialog.querySelector('#employeeContactConfirm');
      if (enabled.checked && candidates.length && (!candidate.value || needsReview && !confirm.checked)) { status.textContent = 'Choose and confirm the correct existing Contact.'; return; }
      button.disabled = true; status.textContent = 'Saving account and Contact…';
      try {
        const result = await settings.client.rpc('save_employee_contact_details', {
          p_profile_id: account.id, p_name: dialog.querySelector('#employeeContactName').value.trim(),
          p_email: dialog.querySelector('#employeeContactEmail').value.trim(), p_phone: phone,
          p_add_to_contacts: enabled.checked, p_contact_id: enabled.checked && candidate && candidate.value || null,
          p_confirm_review: !!(confirm && confirm.checked)
        });
        if (result.error) throw result.error;
        await settings.onSaved();
        dialog.close();
      } catch (error) { status.textContent = error.message || 'The account and Contact could not be saved. Try again.'; }
      finally { button.disabled = false; }
    });
    dialog.showModal();
  }
  window.JgcEmployeeContacts = { validPhone, accountCell, loadLinks, edit };
})();
