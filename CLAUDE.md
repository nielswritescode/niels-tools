Please make a new commit with a message for every new feature. Smaller changes can go together.

Always push after commits on main.

# Multi-agent workflows

## synctree

When I ask to "synctree" (or to point this worktree's HEAD at the newest main commit), do the following:

1. Run `git status`. If the working tree isn't clean, stop and tell me — don't stash or discard anything automatically.
2. Confirm this worktree's current HEAD is already merged into `main`: `git merge-base --is-ancestor HEAD main`.
   - If it's NOT an ancestor, stop. Show `git log main..HEAD --oneline` (commits unique to this worktree) and `git log HEAD..main --oneline` (what main has that this worktree doesn't), and ask how to proceed — resetting now would drop the unique commits.
3. If HEAD is an ancestor of main (safe, no unique work would be lost), run `git reset --hard main`.
4. Report the new HEAD and summarize what came in (the commits between the old HEAD and the new one).

# Commands

- cleanup - merge open worktrees if they are done, then remove the worktree
