/**
 * linkedin_delete_post tool handler.
 * Deletes a LinkedIn post by its Unipile post ID.
 */

import { deletePost } from '../unipile-client.js';

export async function handleDelete(args) {
  const { post_id } = args;

  if (!post_id || typeof post_id !== 'string' || post_id.trim().length === 0) {
    return { error: 'post_id is required (the Unipile post ID returned by linkedin_publish)' };
  }

  const result = await deletePost(post_id.trim());
  if (!result.success) {
    return { error: result.error, details: result.details };
  }

  return {
    status: 'deleted',
    post_id: post_id.trim()
  };
}
