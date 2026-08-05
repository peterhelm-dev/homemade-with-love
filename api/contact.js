module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { name, email, message, company } = req.body || {};

  // Honeypot: real visitors never fill this hidden field.
  if (company) {
    res.status(200).json({ ok: true });
    return;
  }

  if (!name || !email || !message) {
    res.status(400).json({ error: 'Please fill in your name, email, and order details.' });
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set');
    res.status(500).json({ error: 'Something went wrong. Please email us directly.' });
    return;
  }

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Homemade with Love Website <onboarding@resend.dev>',
        to: ['homemadewithlove4usa@gmail.com'],
        reply_to: email,
        subject: `New order inquiry from ${name}`,
        text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error('Resend error:', errText);
      // TEMP DEBUG: surfacing the real error to the caller while we diagnose setup.
      // Will be reverted to a generic message once sending is confirmed working.
      res.status(502).json({ error: 'Something went wrong sending your message. Please email us directly.', debug: errText });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong sending your message. Please email us directly.' });
  }
};
