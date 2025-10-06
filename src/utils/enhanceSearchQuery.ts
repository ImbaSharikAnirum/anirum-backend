import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Обогащение поискового запроса 2-3 самыми релевантными тегами с помощью GPT-5 nano
 * Фокусируется на точности поиска, а не полноте охвата
 *
 * @param query - Поисковый запрос (на русском или английском)
 * @returns Массив из 2-3 самых релевантных английских тегов
 */
export async function enhanceSearchQuery(
  query: string
): Promise<{ originalQuery: string; enhancedTags: string[] }> {
  try {
    if (!query.trim()) {
      return { originalQuery: query, enhancedTags: [] };
    }

    const response = await openai.chat.completions.create({
      model: "gpt-5-nano-2025-08-07",
      messages: [
        {
          role: "system",
          content: `You are an assistant for a drawing tutorial search system. Given a search query, generate ONLY 2-3 most relevant lowercase English tags for precise search.

Rules:
1. Return MAXIMUM 3 tags (2-3 is optimal)
2. Focus on the MAIN subject/concept only
3. Use specific terms, not generic ones
4. Translate Russian → English directly
5. Avoid synonyms - only the most essential tags

Examples:
- "нарисовать лицо" → face, portrait
- "рука человека" → hand, anatomy
- "перспектива в рисунке" → perspective, depth
- "как рисовать волосы" → hair, texture
- "глаза аниме" → eyes, anime
- "портрет карандашом" → portrait, pencil

IMPORTANT: Return ONLY 2-3 tags maximum. More tags = less precise results.
Avoid: 'art', 'drawing', 'tutorial', 'guide', 'sketch', 'illustration'.

Reply with only a comma-separated list of 2-3 tags.`,
        },
        {
          role: "user",
          content: `Generate related search tags for: "${query}"`,
        },
      ],
    });

    const tagString = response.choices[0].message.content?.trim() || "";

    const enhancedTags = tagString
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length < 30)
      .slice(0, 3); // 🔧 Гарантируем максимум 3 тега для точности поиска

    console.log(`🎯 Enhanced search "${query}" → ${enhancedTags.length} tags:`, enhancedTags);

    return {
      originalQuery: query,
      enhancedTags,
    };
  } catch (err) {
    console.error("Ошибка при обогащении поискового запроса:", err);
    return { originalQuery: query, enhancedTags: [] };
  }
}