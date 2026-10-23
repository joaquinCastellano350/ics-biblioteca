-- Modelo de catálogo de Confluence v4. No contiene carga inicial.
CREATE TABLE "books" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "title_search" TEXT NOT NULL,
    "pdf_object_key" TEXT NOT NULL,
    "total_copies" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "books_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "books_total_copies_nonnegative" CHECK ("total_copies" >= 0)
);

CREATE TABLE "authors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "book_authors" (
    "book_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    CONSTRAINT "book_authors_pkey" PRIMARY KEY ("book_id", "author_id"),
    CONSTRAINT "book_authors_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "book_authors_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "book_subjects" (
    "book_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    CONSTRAINT "book_subjects_pkey" PRIMARY KEY ("book_id", "subject_id"),
    CONSTRAINT "book_subjects_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "book_subjects_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "book_authors_author_id_book_id_idx" ON "book_authors"("author_id", "book_id");
CREATE INDEX "book_subjects_subject_id_book_id_idx" ON "book_subjects"("subject_id", "book_id");
