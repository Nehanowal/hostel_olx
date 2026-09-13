export const categories = [
  { id: "Electronics", icon: "Headphones", fields: ["Brand", "Model"] },
  { id: "Books", icon: "BookOpen", fields: ["Author", "Course / edition"] },
  { id: "Room essentials", icon: "Lamp", fields: ["Brand"] },
  { id: "Fashion", icon: "Shirt", fields: ["Size", "Brand"] },
  { id: "Sports", icon: "Bike", fields: ["Sport", "Size"] },
  { id: "Other", icon: "Package", fields: [] },
];

export const conditions = ["Like new", "Good", "Fair", "New"];
export async function seedDemo(db, university, domain) {
  if (await db.prepare("SELECT 1 FROM listings LIMIT 1").get()) return;
  const now = new Date().toISOString();
  for (const [id, name] of [
    ["demo-aanya", "Aanya S."],
    ["demo-arjun", "Arjun K."],
  ]) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO users (id,email,name,university,verified_at) VALUES (?,?,?,?,?)",
      )
      .run(id, `${id}@${domain}`, name, university, now);
  }
  const items = [
    [
      "noise-cancelling-headphones",
      "Over-ear headphones",
      1800,
      "Electronics",
      "Like new",
      "North hostel",
      "1612858250298-8cbd5f65e6e8",
      "Comfortable headphones for long study sessions. Includes the original cable.",
    ],

    [
      "desk-lamp",
      "A little light for late nights",
      450,
      "Room essentials",
      "Good",
      "Library entrance",
      "1582737068506-19cfa00233ee",
      "Adjustable study lamp. Works perfectly and fits even a small hostel desk.",
    ],

    [
      "semester-books",
      "Your next semester, sorted",
      350,
      "Books",
      "Good",
      "Academic block",
      "1520467795206-62e33627e6ce",
      "A bundle of pre-loved reading. Check the titles with the seller before arranging pickup.",
    ],

    [
      "everyday-backpack",
      "The everyday campus backpack",
      650,
      "Fashion",
      "Like new",
      "South hostel",
      "1622560257067-108402fcedc0",
      "Spacious everyday backpack with comfortable straps and room for your essentials.",
    ],

    [
      "casual-sneakers",
      "Grey sneakers · size 8",
      1200,
      "Fashion",
      "Good",
      "Sports centre",
      "1577982787983-e07c6730f2d3",
      "Gently used sneakers. Cleaned and ready for a second home. Try them on at pickup.",
    ],

    [
      "study-chair",
      "An upgrade for your study corner",
      950,
      "Room essentials",
      "Good",
      "North hostel",
      "1547587091-f883cf8f0c12",
      "Simple, comfortable chair. Selling before moving out. Campus pickup only.",
    ],
  ];

  for (const [
    i,
    [id, title, price, category, condition, location, photo, description],
  ] of items.entries()) {
    const seller = i % 2 ? "demo-arjun" : "demo-aanya";
    await db
      .prepare(
        "INSERT INTO listings (id,seller_id,university,title,description,category,price,condition,location,is_demo) VALUES (?,?,?,?,?,?,?,?,?,1)",
      )
      .run(
        id,
        seller,
        university,
        title,
        description,
        category,
        price * 100,
        condition,
        location,
      );
    await db
      .prepare(
        "INSERT INTO images (id,owner_id,listing_id,path,created_at) VALUES (?,?,?,?,?)",
      )
      .run(
        `photo-${id}`,
        seller,
        id,
        `https://images.unsplash.com/photo-${photo}?auto=format&fit=crop&w=900&q=80`,
        Date.now(),
      );
  }
}
