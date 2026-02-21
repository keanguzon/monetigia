import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './src/types/database';

const supabase = createBrowserClient(
    'http://localhost',
    'key'
) as SupabaseClient<Database>;

const builder = supabase.from('transactions');
const insertResult = builder.insert([{ user_id: '123', account_id: '123', category_id: null, type: 'expense', amount: 100, description: 'test', date: '2023-01-01', transfer_to_account_id: null }]);
