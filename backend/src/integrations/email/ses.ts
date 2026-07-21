import { env } from '../../env.js';

export type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

let sesClient: unknown = null;
let SendEmailCommand: unknown = null;

async function loadSes() {
  if (sesClient) return { sesClient, SendEmailCommand };
  const mod = await import('@aws-sdk/client-sesv2');
  sesClient = new mod.SESv2Client({ region: env.SES_REGION });
  SendEmailCommand = mod.SendEmailCommand;
  return { sesClient, SendEmailCommand };
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (env.EMAIL_TRANSPORT === 'console') {
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '─── OUTGOING EMAIL (console transport) ───',
        `To:      ${payload.to}`,
        `From:    ${env.EMAIL_FROM}`,
        `Subject: ${payload.subject}`,
        '',
        payload.text,
        '──────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    return;
  }

  const { sesClient: client, SendEmailCommand: Cmd } = await loadSes();
  type SesClient = { send: (cmd: unknown) => Promise<unknown> };
  type SesCmdCtor = new (input: unknown) => unknown;
  const cmd = new (Cmd as SesCmdCtor)({
    FromEmailAddress: env.EMAIL_FROM,
    Destination: { ToAddresses: [payload.to] },
    Content: {
      Simple: {
        Subject: { Data: payload.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: payload.text, Charset: 'UTF-8' },
          ...(payload.html
            ? { Html: { Data: payload.html, Charset: 'UTF-8' } }
            : {}),
        },
      },
    },
  });
  await (client as SesClient).send(cmd);
}
