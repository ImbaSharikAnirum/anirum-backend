import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Генерация тегов по изображению с помощью GPT-5 nano
 * Оптимизировано для платформы обучения рисованию
 */
export async function generateTagsFromImage(imageUrl: string): Promise<string[]> {
  try {
    console.log("🚀 Начало генерации тегов для URL:", imageUrl);

    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [
        {
          role: "system",
          content: `You are an assistant for a drawing tutorial platform. Analyze an image from a tutorial and return 5 to 10 lowercase English tags that clearly describe what is being drawn or demonstrated. Tags should represent objects (e.g. 'hands', 'head'), concepts (e.g. 'perspective', 'volume'), or techniques (e.g. 'shading', 'construction'). Do not include vague or generic terms like 'art', 'drawing', 'illustration', or words about how the tutorial is presented, such as 'step-by-step', 'guide', or 'diagram'. Reply with only a comma-separated list of useful tags.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Generate tags for this image:" },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      max_completion_tokens: 200, 
    });

    console.log("✅ OpenAI API ответил успешно");
    console.log("📊 Usage:", response.usage);

    const tagString = response.choices[0].message.content?.trim() || "";
    console.log("📝 Сырой ответ от OpenAI:", tagString);

    // Преобразуем "eyes, drawing, anatomy" → ["eyes", "drawing", "anatomy"]
    const tags = tagString
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length < 30); // фильтруем слишком длинные теги

    console.log(`Generated ${tags.length} tags from image:`, tags);

    return tags;
  } catch (err) {
    console.error("❌ Детальная ошибка при генерации тегов:");
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    console.error("Error code:", err.code);
    console.error("Full error:", err);
    return [];
  }
}