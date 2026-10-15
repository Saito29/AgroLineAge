// Public browser configuration only. Never add a Supabase secret/service-role key here.
const CFG = {
  SUPABASE_URL: "https://wlpdpuoosqcgqhcquzur.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_jFNRvR9m_ngUrvbFByPwXA_dzi6myC_",
  ORG_NAME: "Farmers Organization Livestock Family Tree", // used as the PowerPoint title (organizations themselves are managed inside the app)
  // Choices shown in the "Insurance agency" dropdown of the animal form. Edit freely.
  INSURERS: ["PCIC (Philippine Crop Insurance Corp.)", "CLIMBS", "Private insurance company", "Cooperative / mutual aid fund", "Other"],
  MAX_FILE_MB: 50, // largest single attachment
};
