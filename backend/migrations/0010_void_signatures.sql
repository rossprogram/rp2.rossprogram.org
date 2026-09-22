CREATE TABLE `agreement_signature_void` (
	`id` text PRIMARY KEY NOT NULL,
	`signature_id` text NOT NULL,
	`application_id` text NOT NULL,
	`document` text NOT NULL,
	`signer_kind` text NOT NULL,
	`signer_user_id` text NOT NULL,
	`typed_name` text NOT NULL,
	`document_version` text NOT NULL,
	`document_hash` text NOT NULL,
	`signed_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`voided_by_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`voided_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`signer_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`voided_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `agreement_signature_void_application_idx` ON `agreement_signature_void` (`application_id`);