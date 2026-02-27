import admin from 'firebase-admin';

// Initialize Firebase Admin SDK (only once)
if (!admin.apps.length) {
  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccount)),
      });
      console.log('Firebase Admin SDK initialized');
    } else {
      console.warn('FIREBASE_SERVICE_ACCOUNT not set — auth verification disabled');
    }
  } catch (err) {
    console.error('Failed to initialize Firebase Admin:', err.message);
  }
}

/**
 * Optional auth middleware.
 * If a valid Bearer token is present, sets req.userId and req.userEmail.
 * Never rejects — unauthenticated requests pass through with req.userId = null.
 */
export default async function optionalAuth(req, res, next) {
  req.userId = null;
  req.userEmail = null;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || !admin.apps.length) {
    return next();
  }

  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.userId = decoded.uid;
    req.userEmail = decoded.email;
  } catch (e) {
    // Invalid token — continue as unauthenticated
  }

  next();
}
