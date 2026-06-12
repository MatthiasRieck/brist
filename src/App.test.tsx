import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "./router";

const { mockInvoke, mockOpen } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockOpen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mockOpen }));

function renderApp() {
  const testRouter = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={testRouter} />);
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when no folders are loaded", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories
    renderApp();
    expect(await screen.findByText("No folders added yet.")).toBeInTheDocument();
  });

  it("renders all loaded folders", async () => {
    mockInvoke.mockResolvedValueOnce(["/home/user/documents", "/home/user/pictures"]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories
    renderApp();
    expect(await screen.findByText("documents")).toBeInTheDocument();
    expect(screen.getByText("pictures")).toBeInTheDocument();
  });

  it("adds a folder when the dialog confirms a selection", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories (initial)
    mockOpen.mockResolvedValueOnce("/home/user/new-folder");
    mockInvoke.mockResolvedValueOnce(["/home/user/new-folder"]); // add_folder
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories (after add)

    renderApp();
    await screen.findByText("No folders added yet.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ Add Folder" }));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_folder", {
        path: "/home/user/new-folder",
      });
    });
    expect(screen.getByText("new-folder")).toBeInTheDocument();
  });

  it("does nothing when the dialog is cancelled", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories
    mockOpen.mockResolvedValueOnce(null);

    renderApp();
    await screen.findByText("No folders added yet.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ Add Folder" }));
    });

    expect(mockInvoke).not.toHaveBeenCalledWith("add_folder", expect.anything());
    expect(screen.getByText("No folders added yet.")).toBeInTheDocument();
  });

  it("removes a folder when Remove is clicked", async () => {
    mockInvoke.mockResolvedValueOnce(["/home/user/documents"]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories (initial)
    mockInvoke.mockResolvedValueOnce([]); // remove_folder
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories (after remove)

    renderApp();
    await screen.findByText("documents");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove documents" }));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("remove_folder", {
        path: "/home/user/documents",
      });
    });
    expect(screen.getByText("No folders added yet.")).toBeInTheDocument();
  });

  it("shows empty repositories state when no repos are found", async () => {
    mockInvoke.mockResolvedValueOnce(["/home/user/projects"]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories
    renderApp();
    expect(await screen.findByText("No repositories found.")).toBeInTheDocument();
  });

  it("renders discovered repositories with name and full path", async () => {
    mockInvoke.mockResolvedValueOnce(["/home/user/projects"]); // get_folders
    mockInvoke.mockResolvedValueOnce(["/home/user/projects/myapp", "/home/user/projects/otherapp"]); // scan_repositories
    renderApp();
    expect(await screen.findByText("myapp")).toBeInTheDocument();
    expect(screen.getByText("otherapp")).toBeInTheDocument();
  });

  it("navigates to the repo page with categorized branches when a repo is clicked", async () => {
    const repo = "/home/user/projects/myapp";
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "get_folders":
          return Promise.resolve(["/home/user/projects"]);
        case "scan_repositories":
          return Promise.resolve([repo]);
        case "get_branches":
          return Promise.resolve([
            {
              name: "main",
              is_current: true,
              upstream: "origin/main",
              ahead: 0,
              behind: 2,
              is_remote: false,
              gone: false,
              author_email: "me@example.com",
              committer_date: 1700000000,
            },
            {
              name: "feature/x",
              is_current: false,
              upstream: null,
              ahead: null,
              behind: null,
              is_remote: false,
              gone: false,
              author_email: "me@example.com",
              committer_date: 1700000000,
            },
          ]);
        case "get_worktrees":
          return Promise.resolve([
            {
              path: repo,
              branch: "main",
              head: "abc123",
              is_main: true,
              is_locked: false,
              is_bare: false,
              has_changes: false,
            },
          ]);
        case "get_repo_analysis":
          return Promise.resolve({
            default_branch: "main",
            main_branches: ["main"],
            user_email: "me@example.com",
            branches: [
              {
                name: "main",
                is_main: true,
                target: null,
                ahead_of_target: null,
                behind_target: null,
                is_mine: true,
                mine_override: null,
              },
              {
                name: "feature/x",
                is_main: false,
                target: "main",
                ahead_of_target: 2,
                behind_target: 1,
                is_mine: true,
                mine_override: null,
              },
            ],
          });
        case "get_rebase_session":
          return Promise.resolve(null);
        default:
          return Promise.resolve([]);
      }
    });

    renderApp();
    const repoButton = await screen.findByText("myapp");
    await act(async () => {
      fireEvent.click(repoButton);
    });

    expect((await screen.findAllByText("feature/x")).length).toBeGreaterThan(0);
    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getByText("Worktrees")).toBeInTheDocument();
    expect(screen.getByText(/Rebase all \(1\)/)).toBeInTheDocument();

    // switching the branch of a worktree invokes switch_branch
    const select = screen.getByLabelText(`Branch checked out at ${repo}`);
    await act(async () => {
      fireEvent.change(select, { target: { value: "feature/x" } });
    });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("switch_branch", {
        worktree: repo,
        branch: "feature/x",
      });
    });

    // feature/x has no upstream -> a Publish button pushes it with -u
    const publishButton = await screen.findByRole("button", { name: "Publish" });
    await act(async () => {
      fireEvent.click(publishButton);
    });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("push_branch", {
        repo,
        branch: "feature/x",
        force: false,
      });
    });

    // main is behind only -> offers Pull (fast-forward), never force push
    const pullButton = await screen.findByRole("button", { name: "Pull" });
    await act(async () => {
      fireEvent.click(pullButton);
    });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pull_branch", { repo, branch: "main" });
    });
    expect(screen.queryByRole("button", { name: /Force push/ })).not.toBeInTheDocument();
  });

  it("fetches every repository when the fetch-all button is clicked", async () => {
    const repos = ["/home/user/projects/a", "/home/user/projects/b"];
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "get_folders":
          return Promise.resolve(["/home/user/projects"]);
        case "scan_repositories":
          return Promise.resolve(repos);
        case "fetch_repo":
          return Promise.resolve();
        default:
          return Promise.resolve([]);
      }
    });

    renderApp();
    await screen.findByText("a");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fetch all repositories" }));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("fetch_repo", { path: repos[0] });
      expect(mockInvoke).toHaveBeenCalledWith("fetch_repo", { path: repos[1] });
    });
  });

  it("refreshes repositories after adding a folder", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories (initial)
    mockOpen.mockResolvedValueOnce("/home/user/projects");
    mockInvoke.mockResolvedValueOnce(["/home/user/projects"]); // add_folder
    mockInvoke.mockResolvedValueOnce(["/home/user/projects/myapp"]); // scan_repositories (after add)

    renderApp();
    await screen.findByText("No folders added yet.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ Add Folder" }));
    });

    expect(await screen.findByText("myapp")).toBeInTheDocument();
  });
});
