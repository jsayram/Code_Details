// D09 S01: benchmark-only schema. Deployed only to the throwaway backend that
// tests/bench/search-s01/run.ts starts on the slot's ports with its own state
// folder; never part of the app schema (convex/schema.ts).
//
// Two search indexes over the same documents: search_raw indexes the
// projection's searchText as is (approach A0, plain native search);
// search_ext indexes searchTextExt, the same text with the vocabulary layer's
// identifier rewrites and canonical tokens added (approach A1).

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  docs: defineTable({
    entityId: v.string(),
    corpus: v.string(),
    title: v.string(),
    category: v.string(),
    owner: v.string(),
    tagNames: v.array(v.string()),
    searchText: v.string(),
    searchTextExt: v.string(),
    eligible: v.boolean(),
    favorites: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .searchIndex("search_raw", { searchField: "searchText", filterFields: ["eligible", "category", "owner"] })
    .searchIndex("search_ext", { searchField: "searchTextExt", filterFields: ["eligible", "category", "owner"] })
    .index("by_entity", ["entityId"])
    .index("by_eligible_created", ["eligible", "createdAt"])
    .index("by_eligible_category_created", ["eligible", "category", "createdAt"]),
});
