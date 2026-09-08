export type Account = {
  id: string;
  provider: string;
  name: string;
  currency: string;
  account_type: string;
  external_account_id: string | null;
  balance: number | null;
  balance_currency: string | null;
  balance_updated_at: string | null;
  is_archived: boolean;
  created_at: string;
};

export type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  icon: string | null;
  is_income: boolean;
  is_recurring: boolean;
};

export type MccCode = {
  mcc: string;
  description: string | null;
  default_category_id: string | null;
};

export type MerchantRule = {
  id: string;
  pattern: string;
  category_id: string | null;
  created_by: string;
  created_at: string;
};

export type Transaction = {
  id: string;
  account_id: string;
  external_id: string | null;
  booked_at: string;
  amount: number;
  currency: string;
  raw_description: string | null;
  merchant_name: string | null;
  mcc: string | null;
  category_id: string | null;
  category_source: string | null;
  is_internal_transfer: boolean;
  matched_transfer_id: string | null;
  needs_review: boolean;
  created_at: string;
};

export type SyncLog = {
  id: string;
  provider: string;
  status: string;
  message: string | null;
  transactions_synced: number;
  synced_at: string;
};

export type EnableBankingSession = {
  id: string;
  provider: string;
  session_id: string;
  expires_at: string;
  created_at: string;
};

export type FxRate = {
  currency: string;
  rate_to_eur: number;
  updated_at: string;
};

export type BalanceSnapshot = {
  date: string;
  total_balance_eur: number;
  created_at: string;
};

export type AppSetting = {
  key: string;
  value: string | null;
  updated_at: string;
};

export type AiWidget = {
  id: string;
  page: "dashboard" | "analysis";
  title: string;
  spec: unknown;
  position: number;
  created_at: string;
};

export type InvestmentHolding = {
  id: string;
  account_id: string;
  isin: string;
  name: string;
  quantity: number;
  price: number;
  avg_buy_in: number;
  market_value: number;
  currency: string;
  updated_at: string;
};

export type PlaceLookupCache = {
  merchant_key: string;
  place_types: string[] | null;
  matched_category_id: string | null;
  looked_up_at: string;
};

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: Account;
        Insert: Partial<Account> & Pick<Account, "provider" | "name" | "currency" | "account_type">;
        Update: Partial<Account>;
        Relationships: [];
      };
      categories: {
        Row: Category;
        Insert: Partial<Category> & Pick<Category, "name">;
        Update: Partial<Category>;
        Relationships: [];
      };
      mcc_codes: {
        Row: MccCode;
        Insert: Partial<MccCode> & Pick<MccCode, "mcc">;
        Update: Partial<MccCode>;
        Relationships: [];
      };
      merchant_rules: {
        Row: MerchantRule;
        Insert: Partial<MerchantRule> & Pick<MerchantRule, "pattern">;
        Update: Partial<MerchantRule>;
        Relationships: [];
      };
      transactions: {
        Row: Transaction;
        Insert: Partial<Transaction> &
          Pick<Transaction, "account_id" | "booked_at" | "amount" | "currency">;
        Update: Partial<Transaction>;
        Relationships: [];
      };
      sync_log: {
        Row: SyncLog;
        Insert: Partial<SyncLog> & Pick<SyncLog, "provider" | "status">;
        Update: Partial<SyncLog>;
        Relationships: [];
      };
      enable_banking_sessions: {
        Row: EnableBankingSession;
        Insert: Partial<EnableBankingSession> &
          Pick<EnableBankingSession, "provider" | "session_id" | "expires_at">;
        Update: Partial<EnableBankingSession>;
        Relationships: [];
      };
      fx_rates: {
        Row: FxRate;
        Insert: Partial<FxRate> & Pick<FxRate, "currency" | "rate_to_eur">;
        Update: Partial<FxRate>;
        Relationships: [];
      };
      balance_snapshots: {
        Row: BalanceSnapshot;
        Insert: Partial<BalanceSnapshot> & Pick<BalanceSnapshot, "date" | "total_balance_eur">;
        Update: Partial<BalanceSnapshot>;
        Relationships: [];
      };
      app_settings: {
        Row: AppSetting;
        Insert: Partial<AppSetting> & Pick<AppSetting, "key">;
        Update: Partial<AppSetting>;
        Relationships: [];
      };
      ai_widgets: {
        Row: AiWidget;
        Insert: Partial<AiWidget> & Pick<AiWidget, "page" | "title" | "spec">;
        Update: Partial<AiWidget>;
        Relationships: [];
      };
      investment_holdings: {
        Row: InvestmentHolding;
        Insert: Partial<InvestmentHolding> &
          Pick<InvestmentHolding, "account_id" | "isin" | "name" | "quantity" | "price" | "avg_buy_in" | "market_value">;
        Update: Partial<InvestmentHolding>;
        Relationships: [];
      };
      place_lookup_cache: {
        Row: PlaceLookupCache;
        Insert: Partial<PlaceLookupCache> & Pick<PlaceLookupCache, "merchant_key">;
        Update: Partial<PlaceLookupCache>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
