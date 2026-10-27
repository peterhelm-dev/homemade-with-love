const RECIPIENT = 'homemadewithlove4usa@gmail.com';

function clean(value) {
  return String(value == null ? '' : value).replace(/\r/g, '').trim();
}

function oneLine(value) {
  return clean(value).replace(/[\n\t]+/g, ' ').replace(/[ ]{2,}/g, ' ');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parsePhone(value) {
  const raw = clean(value);
  if (!raw) return { error: 'Please add a phone number so Debby can reach you.' };
  if (raw.length > 40) return { error: 'Please enter a valid phone number.' };
  const digits = raw.replace(/\D/g, '');
  let national = digits;
  if (national.length === 11 && national.startsWith('1')) national = national.slice(1);
  if (national.length !== 10) return { error: 'Please enter a valid phone number.' };
  const display = '(' + national.slice(0, 3) + ') ' + national.slice(3, 6) + '-' + national.slice(6);
  return { display: display, e164: '+1' + national };
}

function buildEmail(order) {
  const when = order.when || 'Not given';
  const subject = 'New order: ' + order.name + ', ' + order.town;
  const text = [
    'New order',
    '',
    'Name',
    order.name,
    '',
    'Phone',
    order.phone.display,
    'Call: tel:' + order.phone.e164,
    'Text: sms:' + order.phone.e164,
    '',
    'Email',
    order.email,
    '',
    'Pickup',
    order.town,
    '',
    'When',
    when,
    '',
    'Order',
    order.message
  ].join('\n');

  const html = [
    '<!DOCTYPE html><html><body style="margin:0;padding:16px;font-family:sans-serif;font-size:17px;line-height:1.45;color:#222">',
    '<p style="font-size:20px;margin:0 0 16px"><strong>New order</strong></p>',
    '<p style="margin:0 0 14px"><strong>Name</strong><br>' + escapeHtml(order.name) + '</p>',
    '<p style="margin:0 0 14px"><strong>Phone</strong><br>',
    '<a href="tel:' + order.phone.e164 + '" style="color:#1a56c4;font-size:18px">' + escapeHtml(order.phone.display) + '</a><br>',
    '<a href="sms:' + order.phone.e164 + '" style="color:#1a56c4">Text this number</a></p>',
    '<p style="margin:0 0 14px"><strong>Email</strong><br><a href="mailto:' + escapeHtml(order.email) + '" style="color:#1a56c4">' + escapeHtml(order.email) + '</a></p>',
    '<p style="margin:0 0 14px"><strong>Pickup</strong><br>' + escapeHtml(order.town) + '</p>',
    '<p style="margin:0 0 14px"><strong>When</strong><br>' + escapeHtml(when) + '</p>',
    '<p style="margin:0"><strong>Order</strong><br>' + escapeHtml(order.message).replace(/\n/g, '<br>') + '</p>',
    '</body></html>'
  ].join('');

  return { subject: subject, text: text, html: html };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const name = oneLine(body.name);
  const email = oneLine(body.email);
  const message = clean(body.message);
  const town = oneLine(body.town);
  const when = oneLine(body.when);
  const company = clean(body.company);

  // Honeypot: real visitors never fill this hidden field.
  if (company) {
    res.status(200).json({ ok: true });
    return;
  }

  if (!name || !email || !message) {
    res.status(400).json({ error: 'Please fill in your name, email, and order details.' });
    return;
  }

  if (name.length > 100) {
    res.status(400).json({ error: 'Please shorten your name.' });
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  const phone = parsePhone(body.phone);
  if (phone.error) {
    res.status(400).json({ error: phone.error });
    return;
  }

  if (!town) {
    res.status(400).json({ error: 'Please tell us a pickup town or area near Bedford.' });
    return;
  }

  if (town.length > 80) {
    res.status(400).json({ error: 'Please shorten the pickup town or area.' });
    return;
  }

  if (when.length > 120) {
    res.status(400).json({ error: 'Please shorten the preferred day and time.' });
    return;
  }

  if (message.length > 4000) {
    res.status(400).json({ error: 'Please shorten your order details.' });
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set');
    res.status(500).json({ error: 'Something went wrong. Please email us directly.' });
    return;
  }

  const order = { name: name, email: email, message: message, town: town, when: when, phone: phone };
  const mail = buildEmail(order);

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Homemade with Love Website <orders@homemadewithlove4usa.com>',
        to: [RECIPIENT],
        reply_to: email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error('Resend error:', errText);
      res.status(502).json({ error: 'Something went wrong sending your message. Please email us directly.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong sending your message. Please email us directly.' });
  }
};
