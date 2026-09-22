/*
 * The two documents every family signs before a student may participate.
 *
 * The text lives here, as data, for three reasons:
 *   - the portal renders it, so it must be structured rather than a PDF blob;
 *   - the backend hashes it, so a signature can pin exactly what was on the
 *     screen when someone typed their name;
 *   - the admin view lists it, and a second copy would eventually disagree.
 *
 * Transcribed verbatim from the source PDFs (Code of Conduct, generated
 * 2026-09-21; Program Participation Agreement, generated 2026-09-04). Wording
 * is legal text — do not edit it to fix a typo without saying so out loud.
 *
 * CHANGING A DOCUMENT MEANS BUMPING ITS `version`. Signatures store the
 * version and a hash of the text, so prior signatures keep pointing at what
 * was actually agreed to. Editing text in place without a bump silently
 * rewrites history.
 */

export const AGREEMENT_KEYS = ['code_of_conduct', 'participation_agreement'] as const;
export type AgreementKey = (typeof AGREEMENT_KEYS)[number];

export const SIGNER_KINDS = ['student', 'guardian'] as const;
export type SignerKind = (typeof SIGNER_KINDS)[number];

/** A run of document text. Lists are modelled so they can render as lists. */
export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: readonly string[] };

export type AgreementSection = {
  heading: string | null;
  blocks: readonly Block[];
};

export type AgreementDocument = {
  key: AgreementKey;
  /** Bump on ANY text change. Dated rather than numbered so it self-documents. */
  version: string;
  title: string;
  /** Who must put their name to it. Both documents need both. */
  signers: readonly SignerKind[];
  /**
   * What the signature line actually says for each party. The participation
   * agreement is *signed* by the guardian and *acknowledged* by the student;
   * the code of conduct is acknowledged by both. Reproducing that distinction
   * matters more than it looks — it is the difference between granting
   * permission and accepting rules.
   */
  signatureLabel: Readonly<Record<SignerKind, string>>;
  /** The participation agreement collects guardian contact inline. */
  collectsGuardianContact: boolean;
  sections: readonly AgreementSection[];
};

const CODE_OF_CONDUCT: AgreementDocument = {
  key: 'code_of_conduct',
  version: '2026-09-21',
  title: 'Code of Conduct',
  signers: ['student', 'guardian'],
  signatureLabel: {
    student: 'Acknowledged — participant signature',
    guardian: 'Acknowledged — parent or legal guardian signature',
  },
  collectsGuardianContact: false,
  sections: [
    {
      heading: null,
      blocks: [
        {
          kind: 'p',
          text:
            'The goal of the Ross Mathematics Foundation is to create a wonderful mathematical experience for all participants. A term of deep mathematical focus and inquiry-based exploration requires us to work together. Be prepared to take an active, patient, and generous role in your own learning and that of the other participants. This Code of Conduct aims to ensure that we build the strongest community of mathematicians possible. If participants ever feel harassed, bullied, or are treated in such a way that feels inappropriate or concerning, they are empowered to raise concerns with Ross staff. Staff are here to listen and help address participant concerns.',
        },
        {
          kind: 'p',
          text:
            'Violations of this Code of Conduct may result in consequences including, but not limited to, warnings, restriction of privileges, removal from activities, parent/guardian notification, or dismissal from the Program, at the discretion of Ross Directors.',
        },
      ],
    },
    {
      heading: 'Harassment Policy',
      blocks: [
        {
          kind: 'p',
          text:
            'The Ross Mathematics Foundation will not tolerate discrimination, harassment, or bullying. Every participant has something to add to our community of mathematics. The Foundation seeks to offer fair and equitable treatment to every participant, and the Foundation will not discriminate based on gender identity, nationality, race or ethnicity, religion, age, marital status, sexual orientation, or disability.',
        },
        {
          kind: 'p',
          text:
            'Language you find acceptable may be offensive to others, so we aim for a higher standard of care and concern to communicate our respect for one another. If you feel uncomfortable with the way that you are being treated, or if you notice that someone else is being treated in a way that is disrespectful or inappropriate, please contact ross@rossprogram.org immediately. You may alternatively submit an anonymous report or communicate with the participant ombudsperson. Reports will be handled as promptly and confidentially as possible.',
        },
      ],
    },
    {
      heading: 'Academic Integrity',
      blocks: [
        {
          kind: 'p',
          text:
            'The Ross Program has high expectations. Our motto is to "Think deeply about simple things." This motto captures our core values and mission: to foster intellectual creativity, productivity, communication, teamwork, and integrity in young mathematicians. All Participants are required to show academic integrity at all times in the Program.',
        },
        {
          kind: 'p',
          text:
            'Academic misconduct is a failure of academic integrity. Specifically, academic misconduct is cheating, plagiarism, or otherwise interfering with the intellectual growth of other Participants (or themselves). Examples include:',
        },
        {
          kind: 'list',
          items: [
            'Using the work of others (including the work of AI and LLM systems), or misrepresenting another person’s ideas as your own',
            'Using unauthorized resources such as textbooks or online materials to find answers to problems',
          ],
        },
        {
          kind: 'p',
          text:
            'Each participant must ensure that their submissions to Program problem sets honestly represent their own understanding and work. It is far better to be puzzled by hard math problems and discuss them with others, rather than searching for answers elsewhere. That being said, collaboration is strongly encouraged. Mathematics is a uniquely human endeavor (as far as we know), and exploring mathematics is far more joyful when done together.',
        },
      ],
    },
    {
      heading: 'Expected Behaviors',
      blocks: [
        {
          kind: 'p',
          text:
            'In general, we abide by the aphorism: "Treat other people the way you would like to be treated." More explicitly, participants in RP2 agree to:',
        },
        {
          kind: 'list',
          items: [
            'Abide by all Program policies and procedures',
            'Demonstrate respect in speech and all actions for all people and Program spaces',
            'Attend their section’s weekly problem session and office hours',
            'Devote consistent, genuine time and effort to engaging with the mathematical program each week',
            'Follow instructions given by instructors, teaching assistants, and other Ross staff',
            'Acknowledge that Ross staff are in charge of Program spaces, including the Discord server and all Zoom sessions',
            'Keep communication with Program staff in shared, visible spaces: staff and Participants do not hold private one-on-one direct-message conversations or video calls; questions belong in section channels, group settings, or scheduled office hours',
            'Comply with all applicable laws and with the terms of service of the platforms the Program uses',
          ],
        },
        {
          kind: 'p',
          text: 'Behaviors that are not permitted include but are not limited to:',
        },
        {
          kind: 'list',
          items: [
            'Spending excessive time on activities that detract from participation in the academic program',
            'Disrupting Program sessions or Program platforms',
            'Taking screenshots, photographs, or recordings of other Participants or of Program sessions without explicit permission',
            'Sharing Program materials outside the Program, including posting problem sets, solutions, or meeting links publicly or with non-Participants',
            'Inappropriate conduct, including but not limited to: jokes, comments, or gestures that are discriminatory, demeaning, or inappropriate; indecent exposure; unwelcome, persistent, or targeted personal contact, including unwanted direct messages; possession, or sharing, of sexually explicit materials; harassment, teasing, or hazing',
            'Verbal abuse by using inappropriate language, gossip, threats, teasing, exclusion, or harassment.',
          ],
        },
      ],
    },
    {
      heading: 'Safety and Wellbeing',
      blocks: [
        {
          kind: 'p',
          text:
            'The safety and wellbeing of participants is our utmost priority at the Ross Program. Accordingly, in addition to the conduct prescribed above, we expect participants to:',
        },
        {
          kind: 'list',
          items: [
            'Maintain a healthy balance among the Program, school, and rest',
            'Inform staff of any health or medical concerns or conditions that may affect their participation',
            'Speak up if they have questions or concerns about any situations they witness, become aware of, or are a part of at the Program',
          ],
        },
        {
          kind: 'p',
          text:
            'Mental health concerns are health concerns. If participants feel stressed, anxious, depressed, or otherwise unable to fully participate in the Program, they should inform Ross staff immediately. Participants who are aware of others in distress are also expected to notify staff. The Program will respond to such situations with appropriate care and support.',
        },
      ],
    },
  ],
};

const PARTICIPATION_AGREEMENT: AgreementDocument = {
  key: 'participation_agreement',
  version: '2026-09-04',
  title: 'Program Participation Agreement',
  signers: ['guardian', 'student'],
  signatureLabel: {
    guardian: 'Signed — parent or legal guardian signature',
    student: 'Acknowledged — participant signature',
  },
  collectsGuardianContact: true,
  sections: [
    {
      heading: null,
      blocks: [
        {
          kind: 'p',
          text:
            'I, the undersigned, as parent or guardian (the “Guardian”), give permission for the Participant named below to attend RP2 (the “Program”), an online program of the Ross Mathematics Program running September 27 through December 12, 2026.',
        },
      ],
    },
    {
      heading: 'Dismissal Agreement',
      blocks: [
        {
          kind: 'p',
          text:
            'The Guardian understands that Ross Directors (the “Directors”) may dismiss the Participant from the Program at any time, in their sole and final discretion, including but not limited to violations of the Code of Conduct, failure to participate meaningfully in the academic program, failure to follow the directions of Program staff, behavior that is disruptive to the community, or health, safety, or wellbeing concerns that, in the judgment of the Directors, cannot be reasonably accommodated within the Program’s resources or would pose a risk to the Participant or others, or any conduct that the Directors determine is not in the best interests of the Participant or the Program.',
        },
        {
          kind: 'p',
          text:
            'In the event of dismissal, the Guardian acknowledges and agrees that the Participant’s access to all Program platforms — including the Program portal, Zoom sessions, the Program Discord server, and Gradescope — will end immediately.',
        },
        {
          kind: 'p',
          text:
            'The Guardian agrees to remain reachable at the contact details given below, and to respond as promptly as reasonably possible, and in any case within 24 hours. The Guardian acknowledges and agrees to abide by all dismissal decisions made by the Directors and that such decisions are final, may take effect immediately, and are not subject to appeal or review.',
        },
        {
          kind: 'p',
          text:
            'The Participant acknowledges and agrees to comply with the Code of Conduct and to cease participation immediately if dismissed by the Directors. The Guardian agrees and acknowledges to ensure that the Participant complies with these obligations.',
        },
        {
          kind: 'p',
          text: 'Program fees will not be refunded in the event of dismissal or voluntary withdrawal.',
        },
      ],
    },
    {
      heading: 'Technology and Accounts',
      blocks: [
        {
          kind: 'p',
          text:
            'The Participant’s Program account, and the associated Zoom, Discord, and Gradescope access, are for the Participant’s personal use only. The Participant agrees not to share account credentials, and not to share Program meeting links or invitations with anyone outside the Program.',
        },
        {
          kind: 'p',
          text:
            'The Program uses third-party services to operate, currently including Zoom (live sessions), Discord (community and communication), Gradescope (problem set submission), and Stripe (payment processing). The Guardian consents to the Participant’s use of these services for Program purposes and acknowledges that each is governed by its own terms of service, including minimum-age requirements.',
        },
        {
          kind: 'p',
          text:
            'The Ross Mathematics Foundation collects only the information needed to run the Program — account and contact information, coursework, and session recordings. The Ross Mathematics Foundation does not sell, give, trade, or otherwise disclose personal data to third parties for marketing purposes.',
        },
      ],
    },
    {
      heading: 'Session Recordings and Likeness',
      blocks: [
        {
          kind: 'p',
          text:
            'Program sessions may be recorded so that Participants who miss a meeting can catch up, and for other Program purposes. The Participant and the Guardian grant the Ross Mathematics Foundation permission to record Program sessions in which the Participant appears, and to use the Participant’s likeness from such recordings or from Program events in its publications and in any and all other media, whether now known or hereafter existing. The Participant will make no monetary or other claim against the Ross Mathematics Foundation for the use of such recordings or images. The Guardian releases all claims against the Program with respect to copyright ownership and publication, including any claim for compensation related to use of the materials.',
        },
      ],
    },
    {
      heading: 'Engagement Commitment',
      blocks: [
        {
          kind: 'p',
          text:
            'The Participant acknowledges that the Ross Mathematics Program thrives on active and wholehearted engagement from all members of the Ross community. Moreover, the Participant acknowledges that access to programs like RP2 is limited: every seat given is a seat another applicant was turned away from. As such, the Participant agrees to attend their section’s weekly problem session and office hours, to notify Program staff in advance of any unavoidable absence, and to devote consistent, genuine time and effort to the Program’s problem sets each week. Routine school-year commitments — schoolwork, practicing a musical instrument, daily exercise, and the like — are of course expected and need no approval.',
        },
      ],
    },
    {
      heading: 'Liability Release',
      blocks: [
        {
          kind: 'p',
          text:
            'The Guardian and the Participant hereby release and forever discharge the Ross Mathematics Foundation, the Board of Trustees, and all employees and officers and agents of these entities from any and all claims, demands, or actions for any damages arising out of or related to participation in the Program, except to the extent caused by gross negligence or willful misconduct.',
        },
        {
          kind: 'p',
          text:
            'If any provision of this Agreement is held invalid or unenforceable, the remaining provisions shall remain in full force and effect.',
        },
      ],
    },
  ],
};

export const AGREEMENTS: readonly AgreementDocument[] = [
  CODE_OF_CONDUCT,
  PARTICIPATION_AGREEMENT,
];

export function agreementByKey(key: string): AgreementDocument | undefined {
  return AGREEMENTS.find((d) => d.key === key);
}

/** Every (document, signer) pair a family must complete. Four, today. */
export function requiredSignatures(): readonly { document: AgreementKey; signer: SignerKind }[] {
  return AGREEMENTS.flatMap((d) => d.signers.map((s) => ({ document: d.key, signer: s })));
}

/**
 * A stable, whitespace-insensitive serialization of the document's text.
 *
 * The backend hashes this and stores the digest on the signature. It is
 * deliberately derived from the CONTENT, not from `version` — bumping the
 * version without changing a word leaves the hash alone, and changing a word
 * without bumping the version is still detectable after the fact.
 *
 * Not a hash itself: hashing needs node:crypto, and this module is imported by
 * the browser bundle too.
 */
export function agreementCanonicalText(doc: AgreementDocument): string {
  const parts: string[] = [doc.key, doc.title];
  for (const section of doc.sections) {
    if (section.heading) parts.push(section.heading);
    for (const block of section.blocks) {
      if (block.kind === 'p') parts.push(block.text);
      else parts.push(...block.items);
    }
  }
  return parts.join('\n').replace(/\s+/g, ' ').trim();
}
