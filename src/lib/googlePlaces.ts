import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting, GOOGLE_MAPS_API_KEY_SETTING } from "@/lib/appSettings";
import type { Database } from "@/lib/supabase/types";

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

export class GoogleMapsConfigError extends Error {}

async function getApiKey(client: SupabaseClient<Database>): Promise<string> {
  const key = await getSetting(client, GOOGLE_MAPS_API_KEY_SETTING);
  if (!key) {
    throw new GoogleMapsConfigError(
      "Google Maps API key not set. Add one on the Settings page (Google Cloud Console -> APIs & Services, enable \"Places API (New)\")."
    );
  }
  return key;
}

// Buckets map Google Places types (https://developers.google.com/maps/documentation/places/web-service/place-types)
// to a small set of canonical spending-category concepts. Matching against the user's actual
// categories (which can be renamed/translated, see migration 006) is done by exact name match
// first, then by checking whether a synonym appears in (or contains) the category name — no AI
// involved, per the "take the category Google Maps returns" flow this is meant to implement
// directly, distinct from the OpenRouter-based AI fallback used in the review queue.
const TYPE_BUCKETS: { synonyms: string[]; types: string[] }[] = [
  {
    synonyms: ["dining", "restaurant", "food", "eating out", "takeaway", "take away", "cafe", "coffee"],
    types: ["restaurant", "cafe", "bar", "bakery", "meal_takeaway", "meal_delivery", "fast_food_restaurant", "coffee_shop", "night_club"],
  },
  {
    synonyms: ["groceries", "grocery", "supermarket"],
    types: ["grocery_store", "grocery_or_supermarket", "supermarket", "convenience_store"],
  },
  {
    synonyms: ["transport", "transportation", "commute", "car", "fuel", "gas"],
    types: [
      "gas_station",
      "parking",
      "subway_station",
      "train_station",
      "bus_station",
      "taxi_stand",
      "car_rental",
      "electric_vehicle_charging_station",
      "transit_station",
      "light_rail_station",
      "car_repair",
      "car_wash",
      "car_dealer",
    ],
  },
  {
    synonyms: ["health", "medical", "pharmacy", "healthcare"],
    types: ["pharmacy", "drugstore", "hospital", "doctor", "dentist", "physiotherapist", "medical_lab"],
  },
  {
    synonyms: ["fitness", "gym", "sport", "sports"],
    types: ["gym", "fitness_center", "sports_complex"],
  },
  {
    synonyms: ["shopping", "retail", "clothing", "clothes"],
    types: [
      "clothing_store",
      "shoe_store",
      "jewelry_store",
      "electronics_store",
      "furniture_store",
      "home_goods_store",
      "book_store",
      "department_store",
      "shopping_mall",
      "gift_shop",
    ],
  },
  {
    synonyms: ["entertainment", "movies", "cinema", "fun"],
    types: ["movie_theater", "bowling_alley", "amusement_park", "casino", "museum", "art_gallery", "zoo", "tourist_attraction"],
  },
  {
    synonyms: ["travel", "hotel", "lodging", "vacation"],
    types: ["lodging", "hotel", "travel_agency", "airport", "campground", "rv_park"],
  },
  {
    synonyms: ["personal care", "beauty", "salon", "hair"],
    types: ["beauty_salon", "hair_care", "spa", "nail_salon"],
  },
  {
    synonyms: ["pets", "pet", "veterinary"],
    types: ["veterinary_care", "pet_store"],
  },
  {
    synonyms: ["finance", "bank", "banking", "insurance"],
    types: ["bank", "atm", "insurance_agency", "accounting", "finance"],
  },
  {
    synonyms: ["home", "housing", "hardware"],
    types: ["hardware_store", "electrician", "plumber", "locksmith", "home_improvement_store", "moving_company", "furniture_store"],
  },
  {
    synonyms: ["education", "school", "tuition"],
    types: ["school", "university", "primary_school", "secondary_school"],
  },
];

type PlacesSearchResponse = {
  places?: { types?: string[]; primaryType?: string }[];
};

// Queries the Places API (New) Text Search endpoint for the merchant name and returns the
// matched place's types, primary type first. Returns null if no place matched at all (a
// distinct outcome from "place matched but no bucket fit" — both end up needs_review, but only
// this one skips caching place_types since there's nothing to remember).
async function searchPlaceTypes(apiKey: string, query: string): Promise<string[] | null> {
  const res = await fetch(PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.types,places.primaryType",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Places API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as PlacesSearchResponse;
  const place = data.places?.[0];
  if (!place) return null;
  const types = place.types ?? [];
  return place.primaryType ? [place.primaryType, ...types.filter((t) => t !== place.primaryType)] : types;
}

function matchCategoryForPlaceTypes(
  placeTypes: string[],
  categories: { id: string; name: string }[]
): string | null {
  for (const placeType of placeTypes) {
    const bucket = TYPE_BUCKETS.find((b) => b.types.includes(placeType));
    if (!bucket) continue;
    for (const synonym of bucket.synonyms) {
      const exact = categories.find((c) => c.name.toLowerCase() === synonym);
      if (exact) return exact.id;
    }
    for (const synonym of bucket.synonyms) {
      const partial = categories.find(
        (c) => c.name.toLowerCase().includes(synonym) || synonym.includes(c.name.toLowerCase())
      );
      if (partial) return partial.id;
    }
  }
  return null;
}

function normalizeMerchantKey(merchantName: string): string {
  return merchantName.trim().toLowerCase();
}

export type PlaceCategoryLookup = { categoryId: string | null; placeTypes: string[] | null };

// Looks up a merchant on Google Maps and maps its place type to one of the user's existing
// categories. Checks place_lookup_cache first (both hits and prior misses are cached, see
// migration 011) so re-running the classifier never re-bills the same merchant twice.
export async function findCategoryForMerchant(
  client: SupabaseClient<Database>,
  merchantName: string,
  categories: { id: string; name: string }[]
): Promise<PlaceCategoryLookup> {
  const key = normalizeMerchantKey(merchantName);
  if (!key) return { categoryId: null, placeTypes: null };

  const { data: cached } = await client
    .from("place_lookup_cache")
    .select("place_types, matched_category_id")
    .eq("merchant_key", key)
    .maybeSingle();
  if (cached) {
    return { categoryId: cached.matched_category_id, placeTypes: cached.place_types };
  }

  const apiKey = await getApiKey(client);
  const placeTypes = await searchPlaceTypes(apiKey, merchantName);
  const categoryId = placeTypes ? matchCategoryForPlaceTypes(placeTypes, categories) : null;

  await client.from("place_lookup_cache").upsert(
    { merchant_key: key, place_types: placeTypes, matched_category_id: categoryId, looked_up_at: new Date().toISOString() },
    { onConflict: "merchant_key" }
  );

  return { categoryId, placeTypes };
}

// Verifies the configured key works against a fixed, always-resolvable query — doesn't touch
// place_lookup_cache, since a connectivity test shouldn't leave a fake merchant entry behind.
export async function testGoogleMapsKey(client: SupabaseClient<Database>): Promise<string[]> {
  const apiKey = await getApiKey(client);
  const types = await searchPlaceTypes(apiKey, "Eiffel Tower, Paris");
  if (!types) throw new Error("Places API responded but returned no result for a known landmark — check the key's API restrictions.");
  return types;
}
