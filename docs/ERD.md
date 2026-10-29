# ERD

```mermaid
erDiagram
  USER ||--o| STUDENT_PROFILE : memiliki
  USER ||--o| TEACHER_PROFILE : memiliki
  USER ||--o{ FORM : membuat
  USER ||--o{ SUBMISSION : mengerjakan
  USER ||--o{ AUDIT_LOG : melakukan
  USER ||--o{ REFRESH_TOKEN : memakai
  ACADEMIC_YEAR ||--o{ SCHOOL_CLASS : memiliki
  ACADEMIC_YEAR ||--o{ SEMESTER : membagi
  SCHOOL_CLASS ||--o{ STUDENT_PROFILE : menampung
  SCHOOL_CLASS ||--o{ CLASS_MEMBERSHIP : mengelompokkan
  STUDENT_PROFILE ||--o{ CLASS_MEMBERSHIP : menjadi
  FORM ||--o{ FORM_VERSION : berversi
  FORM ||--o{ FORM_ASSIGNMENT : ditugaskan
  FORM_VERSION ||--o{ SUBMISSION : menerima
  SUBMISSION ||--o| GRADE : dinilai
  SUBMISSION ||--o{ GRADE_REVISION : mencatat
  USER {
    uuid id PK
    string email UK
    enum role
    enum status
    string googleSubjectId UK
    string passwordHash
  }
  STUDENT_PROFILE {
    uuid id PK
    uuid userId FK
    string studentLoginId UK
    string nisnHash UK
    string nisnMasked
    boolean firstLogin
    int recordVersion
  }
  FORM {
    uuid id PK
    uuid authorId FK
    string title
    enum status
    boolean quizMode
  }
  FORM_VERSION {
    uuid id PK
    uuid formId FK
    int versionNumber
    json schema
  }
  SUBMISSION {
    uuid id PK
    uuid formVersionId FK
    uuid studentId FK
    uuid clientMutationId UK
    json answers
    float earnedScore
  }
  GRADE {
    uuid id PK
    uuid submissionId FK
    float earnedScore
    datetime releasedAt
  }
```

Schema lengkap tersedia di `apps/api/prisma/schema.prisma`. Entitas `UploadedFile`, `ImportJob`, dan `ImportError` belum ada karena fitur upload dan import belum diterapkan; jangan menganggap diagram ini mencakup fitur tersebut.
