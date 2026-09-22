/* Throwaway: seed a local dev DB so the onboarding page has something to show. */
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import * as s from '../db/schema.js';
import { runMigrations } from '../db/migrate.js';
import { AGREEMENTS } from '@rp2/shared';

runMigrations();
const now = () => Math.floor(Date.now() / 1000);

const adminId = nanoid();
db.insert(s.user).values({ id: adminId, email: 'jim@example.com', createdAt: now() }).run();
db.insert(s.userRole).values({ userId: adminId, role: 'admin', grantedAt: now() }).run();

const people: [string, string, string, string, number][] = [
  ['Ada Lovelace', 'ada', 'QUADRATIC-2', '3', 0],
  ['Alan Turing', 'alan', 'TOPOLOGY-1', '2', 1],
  ['Emmy Noether', 'emmy', 'GGT-1', '5', 2],
  ['Srinivasa Ramanujan', 'srini', 'CGT-2', '1', 3],
  ['Sofia Kovalevskaya', 'sofia', 'TOPOLOGY-2', '4', 0],
];

for (const [name, slug, section, cohort, mode] of people) {
  const sid = nanoid(), gid = nanoid(), appId = nanoid();
  db.insert(s.user).values([
    { id: sid, email: `${slug}@example.com`, createdAt: now() },
    { id: gid, email: `${slug}.parent@example.com`, createdAt: now() },
  ]).run();
  db.insert(s.userRole).values([
    { userId: sid, role: 'applicant', grantedAt: now() },
    { userId: gid, role: 'guardian', grantedAt: now() },
  ]).run();
  db.insert(s.application).values({
    id: appId, applicantUserId: sid, status: 'enrolled', createdAt: now(), updatedAt: now(),
  }).run();
  db.insert(s.applicationResponse).values({
    applicationId: appId, questionKey: 'student_legal_name',
    value: JSON.stringify(name), updatedAt: now(),
  }).run();
  db.insert(s.guardianLink).values({
    id: nanoid(), applicantUserId: sid, guardianUserId: gid, relationship: 'parent',
    createdAt: now(), invitedAt: now(),
    // mode 1 = the guardian who never logged in
    acceptedAt: mode === 1 ? null : now(),
  }).run();
  db.insert(s.offer).values({
    id: nanoid(), applicationId: appId, courseKey:
      section.startsWith('QUAD') ? 'quadratic' : section.startsWith('TOP') ? 'topology'
      : section.startsWith('GGT') ? 'ggt' : 'cgt',
    section, cohort, amountDueCents: 0, response: 'accepted',
    notifiedAt: now(), createdAt: now(), updatedAt: now(),
  }).run();

  // mode 2: student has signed everything, guardian has not.
  // mode 3: fully signed, so they drop off the list entirely.
  const sign = (doc: string, kind: 'student' | 'guardian', who: string) =>
    db.insert(s.agreementSignature).values({
      id: nanoid(), applicationId: appId, document: doc as 'code_of_conduct',
      signerKind: kind, signerUserId: who, typedName: name,
      documentVersion: '2026-09-21', documentHash: 'x', signedAt: now(),
    }).run();

  for (const doc of AGREEMENTS) {
    if (mode === 2 || mode === 3) sign(doc.key, 'student', sid);
    if (mode === 3) sign(doc.key, 'guardian', gid);
  }
}
console.log('seeded; admin = jim@example.com');
