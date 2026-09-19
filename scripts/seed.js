"use strict";

const { config } = require("../server/config");
const db = require("../server/db");
const store = require("../server/store");
const { hashPassword, randomToken } = require("../server/auth");

async function main() {
  if (config.isProduction) {
    console.error("Refusing to seed in production (NODE_ENV=production).");
    process.exit(1);
  }
  if (!config.mongodbUri) {
    console.error("MONGODB_URI is not set. Seed requires a MongoDB connection.");
    process.exit(1);
  }
  const connected = await db.connect();
  if (!connected) {
    console.error("Could not connect to MongoDB.");
    process.exit(1);
  }

  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@bp-learning.local").toLowerCase();
  const existing = await store.findUserByEmail(adminEmail);
  if (existing) {
    console.log(`Development admin already exists: ${adminEmail}`);
    await db.close();
    return;
  }

  const password = process.env.SEED_ADMIN_PASSWORD || randomToken(9) + "!aA1";
  const passwordHash = await hashPassword(password);
  const user = await store.createUser({
    firstName: "Admin",
    lastName: "Développement",
    email: adminEmail,
    role: "admin",
    passwordHash,
    status: "active",
  });

  console.log("Development admin created (dev only, do not use in production):");
  console.log(`  Email    : ${adminEmail}`);
  console.log(`  Password : ${password}`);
  console.log("Store these credentials safely. This password is shown only once.");
  await db.close();
}

main().catch((error) => {
  console.error(`Seed failed: ${error.message}`);
  process.exit(1);
});
