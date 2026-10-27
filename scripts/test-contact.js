const assert = require('node:assert/strict');
const handler = require('../api/contact.js');

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

async function post(body, fetchImpl) {
  const previous = global.fetch;
  global.fetch = fetchImpl;
  process.env.RESEND_API_KEY = 'test-key';
  const req = { method: 'POST', body: body };
  const res = mockRes();
  try {
    await handler(req, res);
  } finally {
    global.fetch = previous;
  }
  return res;
}

function okFetch(calls) {
  return async function (url, options) {
    calls.push({ url: url, options: options });
    return { ok: true, text: async () => '' };
  };
}

async function main() {
  const valid = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '(540) 555-0123',
    town: 'Forest',
    when: 'Saturday morning',
    message: 'Two lip balms\nand the nurturing oil'
  };

  // Wrong method never reaches Resend.
  {
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, text: async () => '' }; };
    const res = mockRes();
    await handler({ method: 'GET', body: valid }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(called, false);
  }

  // Honeypot pretends success and does not send.
  {
    const calls = [];
    const res = await post(Object.assign({}, valid, { company: 'Acme' }), okFetch(calls));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(calls.length, 0);
  }

  // Required fields and phone format are checked before any send.
  {
    const cases = [
      [{ name: 'Jane', email: 'jane@example.com', message: 'Balm' }, 'phone number'],
      [Object.assign({}, valid, { phone: '555-0123' }), 'valid phone'],
      [Object.assign({}, valid, { town: '  ' }), 'pickup town'],
      [Object.assign({}, valid, { email: 'not-an-email' }), 'valid email'],
      [Object.assign({}, valid, { message: '   ' }), 'order details']
    ];
    for (const [body, snippet] of cases) {
      const calls = [];
      const res = await post(body, okFetch(calls));
      assert.equal(res.statusCode, 400, JSON.stringify(res.body));
      assert.match(res.body.error, new RegExp(snippet, 'i'));
      assert.equal(calls.length, 0);
    }
  }

  // A good order emails only the business inbox, with a phone-friendly body.
  {
    const calls = [];
    const res = await post(valid, okFetch(calls));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    const mail = JSON.parse(calls[0].options.body);
    assert.deepEqual(mail.to, ['homemadewithlove4usa@gmail.com']);
    assert.equal(mail.reply_to, 'jane@example.com');
    assert.equal(mail.subject, 'New order: Jane Doe, Forest');
    assert.match(mail.text, /Call: tel:\+15405550123/);
    assert.match(mail.text, /Text: sms:\+15405550123/);
    assert.match(mail.text, /Pickup\nForest/);
    assert.match(mail.text, /When\nSaturday morning/);
    assert.match(mail.text, /Two lip balms/);
    assert.match(mail.html, /href="tel:\+15405550123"/);
    assert.match(mail.html, /href="sms:\+15405550123"/);
    assert.match(mail.html, /Text this number/);
    assert.match(mail.html, /\(540\) 555-0123/);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  }

  // Preferred day/time can be left blank.
  {
    const calls = [];
    const body = Object.assign({}, valid, { when: '' });
    const res = await post(body, okFetch(calls));
    assert.equal(res.statusCode, 200);
    const mail = JSON.parse(calls[0].options.body);
    assert.match(mail.text, /When\nNot given/);
    assert.match(mail.html, /Not given/);
    assert.equal(mail.subject, 'New order: Jane Doe, Forest');
  }

  // Name and town cannot break the subject line.
  {
    const calls = [];
    const body = Object.assign({}, valid, { name: 'Jane\nDoe', town: 'Forest\r\nVA' });
    const res = await post(body, okFetch(calls));
    assert.equal(res.statusCode, 200);
    const mail = JSON.parse(calls[0].options.body);
    assert.equal(mail.subject, 'New order: Jane Doe, Forest VA');
    assert.equal(mail.subject.includes('\n'), false);
  }

  // Visitor text is escaped in the HTML part.
  {
    const calls = [];
    const body = Object.assign({}, valid, { message: '<script>alert(1)</script>' });
    const res = await post(body, okFetch(calls));
    assert.equal(res.statusCode, 200);
    const mail = JSON.parse(calls[0].options.body);
    assert.equal(mail.html.includes('<script>'), false);
    assert.match(mail.html, /&lt;script&gt;/);
  }

  // Missing key and a rejected send never look like success.
  {
    const previous = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, text: async () => '' }; };
    const res = mockRes();
    await handler({ method: 'POST', body: valid }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(called, false);
    process.env.RESEND_API_KEY = previous;
  }

  {
    const calls = [];
    const res = await post(valid, async (url, options) => {
      calls.push({ url: url, options: options });
      return { ok: false, text: async () => 'nope' };
    });
    assert.equal(res.statusCode, 502);
    assert.equal(calls.length, 1);
  }

  console.log('contact form tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
