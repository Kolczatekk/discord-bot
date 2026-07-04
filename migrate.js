const { createClient } = require("@supabase/supabase-js");

// Load environment variables for migration credentials
try { require("dotenv").config(); } catch (_) {}

const OLD_URL = process.env.MIGRATE_OLD_SUPABASE_URL || "";
const OLD_KEY = process.env.MIGRATE_OLD_SUPABASE_KEY || "";

const NEW_URL = process.env.MIGRATE_NEW_SUPABASE_URL || "";
const NEW_KEY = process.env.MIGRATE_NEW_SUPABASE_KEY || "";

const oldClient = createClient(OLD_URL, OLD_KEY);
const newClient = createClient(NEW_URL, NEW_KEY);

const TABLES = [
  "weekly_sales",
  "contest_participants",
  "contests",
  "invite_bonus_invites",
  "invite_counts",
  "invite_fake_accounts",
  "invite_reward_levels",
  "invite_rewards_given",
  "invite_total_joined",
  "invites",
  "ticket_owners"
];

async function runMigration() {
  if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY) {
    console.error("❌ BŁĄD: Ustaw zmienne środowiskowe: MIGRATE_OLD_SUPABASE_URL, MIGRATE_OLD_SUPABASE_KEY, MIGRATE_NEW_SUPABASE_URL, MIGRATE_NEW_SUPABASE_KEY");
    return;
  }

  console.log("🚀 Rozpoczynanie migracji danych ze starej bazy do nowej...");

  for (const table of TABLES) {
    console.log(`\n📋 Migracja tabeli: ${table}...`);
    try {
      // 1. Fetch from old
      const { data, error: fetchError } = await oldClient.from(table).select("*");
      if (fetchError) {
        console.error(`❌ Błąd pobierania z tabeli ${table}:`, fetchError.message);
        continue;
      }
      
      if (!data || data.length === 0) {
        console.log(`ℹ️ Tabela ${table} jest pusta w starej bazie.`);
        continue;
      }

      console.log(`📥 Pobrano ${data.length} wierszy. Wprowadzanie do nowej bazy...`);

      // 2. Upsert to new
      const { error: insertError } = await newClient.from(table).upsert(data);
      if (insertError) {
        console.error(`❌ Błąd zapisu do nowej tabeli ${table}:`, insertError.message);
      } else {
        console.log(`✅ Pomyślnie zmigrowano tabelę ${table}!`);
      }
    } catch (err) {
      console.error(`❌ Wyjątek podczas migracji tabeli ${table}:`, err);
    }
  }

  console.log("\n🏁 Migracja zakończona!");
}

runMigration();
