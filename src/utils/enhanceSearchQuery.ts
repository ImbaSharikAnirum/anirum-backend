import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Обогащение поискового запроса связанными тегами с помощью GPT-5 nano
 * Помогает находить больше релевантных гайдов по семантике
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
          content: `You are an assistant for a drawing tutorial search system. Given a search query, generate 5-10 related lowercase English tags that would help find relevant drawing tutorials.

For example:
- "нарисовать лицо" → face, head, portrait, features, eyes, nose, mouth, anatomy
- "рука человека" → hand, fingers, anatomy, gesture, palm, arm
- "перспектива" → perspective, depth, vanishing, point, horizon, 3d

Include:
- Direct translations (русский → English)
- Related objects and concepts
- Synonyms and variations
- Drawing techniques

Avoid generic terms like 'art', 'drawing', 'tutorial', 'guide'.

Reply with only a comma-separated list of tags.`,
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
      .filter((t) => t.length > 0 && t.length < 30);

    console.log(`Enhanced search "${query}" with ${enhancedTags.length} tags:`, enhancedTags);

    return {
      originalQuery: query,
      enhancedTags,
    };
  } catch (err) {
    console.error("Ошибка при обогащении поискового запроса:", err);
    return { originalQuery: query, enhancedTags: [] };
  }
}