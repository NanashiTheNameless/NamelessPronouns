import db from './db/index.js';
import { newId } from './util/ids.js';
export async function record(event) {
  const {
    type,
    actorUserId = null,
    subjectUserId = null,
    target = null,
    ipHash = null,
    detail = null,
  } = event;
  await db.query(
    `INSERT INTO audit_events
       (id, event_type, actor_user_id, subject_user_id, target, ip_hash, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId(), type, actorUserId, subjectUserId, target, ipHash, detail ? JSON.stringify(detail) : null, Date.now()],
  );
}
export default { record };
