/**
 * One-time script: Set admin custom claim on a Firebase user.
 *
 * Usage:
 *   node scripts/setAdminClaim.js admin@college.edu
 *
 * Requirements:
 *   - FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL
 *     must be set in backend/.env (or exported in shell)
 *   - Run ONCE before the contest.
 */

require('dotenv').config({ path: '../backend/.env' });
const admin = require('firebase-admin');

const email = process.argv[2];
if (!email) {
  console.error('Usage: node setAdminClaim.js <admin-email>');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

async function setAdmin() {
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
    console.log(`✅ Admin claim set for: ${email} (UID: ${user.uid})`);
    console.log('   The user must sign out and sign back in for the claim to take effect.');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
  process.exit(0);
}

setAdmin();
