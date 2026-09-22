import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import * as s from '../db/schema.js';
import { runMigrations } from '../db/migrate.js';
runMigrations();
const now = () => Math.floor(Date.now() / 1000);
const sid = nanoid(), gid = nanoid(), appId = nanoid();
db.insert(s.user).values([
  { id: sid, email: 'bryan@example.com', createdAt: now() },
  { id: gid, email: 'allison@example.com', createdAt: now() },
]).run();
db.insert(s.userRole).values([
  { userId: sid, role: 'applicant', grantedAt: now() },
  { userId: gid, role: 'guardian', grantedAt: now() },
]).run();
db.insert(s.application).values({ id: appId, applicantUserId: sid, status: 'enrolled', createdAt: now(), updatedAt: now() }).run();
db.insert(s.applicationResponse).values({ applicationId: appId, questionKey: 'student_legal_name', value: JSON.stringify('Bryan Ning'), updatedAt: now() }).run();
db.insert(s.guardianLink).values({ id: nanoid(), applicantUserId: sid, guardianUserId: gid, relationship: 'parent', createdAt: now(), acceptedAt: now() }).run();
db.insert(s.offer).values({ id: nanoid(), applicationId: appId, courseKey: 'cgt', section: 'CGT-1', cohort: '3', aidAmountCents: 150000, amountDueCents: 0, response: 'accepted', notifiedAt: now(), createdAt: now(), updatedAt: now() }).run();
// The student has signed both, exactly like the real family.
for (const doc of ['code_of_conduct', 'participation_agreement'] as const) {
  db.insert(s.agreementSignature).values({
    id: nanoid(), applicationId: appId, document: doc, signerKind: 'student',
    signerUserId: sid, typedName: 'Bryan Ning', documentVersion: 'v', documentHash: 'h', signedAt: now(),
  }).run();
}
console.log('APPID=' + appId);
