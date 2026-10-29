ALTER TABLE "OAuthClient" ADD COLUMN "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'client_secret_post';
