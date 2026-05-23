import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const { mockInvoke, mockOpen } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockOpen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mockOpen }));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when no folders are loaded", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories
    render(<App />);
    expect(await screen.findByText("No folders added yet.")).toBeInTheDocument();
  });

  it("renders all loaded folders", async () => {
    mockInvoke.mockResolvedValueOnce(["/home/user/documents", "/home/user/pictures"]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories
    render(<App />);
    expect(await screen.findByText("/home/user/documents")).toBeInTheDocument();
    expect(screen.getByText("/home/user/pictures")).toBeInTheDocument();
  });

  it("adds a folder when the dialog confirms a selection", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories (initial)
    mockOpen.mockResolvedValueOnce("/home/user/new-folder");
    mockInvoke.mockResolvedValueOnce(["/home/user/new-folder"]); // add_folder
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories (after add)

    render(<App />);
    await screen.findByText("No folders added yet.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ Add Folder" }));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_folder", {
        path: "/home/user/new-folder",
      });
    });
    expect(screen.getByText("/home/user/new-folder")).toBeInTheDocument();
  });

  it("does nothing when the dialog is cancelled", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories
    mockOpen.mockResolvedValueOnce(null);

    render(<App />);
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

    render(<App />);
    await screen.findByText("/home/user/documents");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("remove_folder", {
        path: "/home/user/documents",
      });
    });
    expect(screen.getByText("No folders added yet.")).toBeInTheDocument();
  });

  it("shows empty repositories state when no repos are found", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories
    render(<App />);
    expect(await screen.findByText("No repositories found.")).toBeInTheDocument();
  });

  it("renders discovered repositories with name and full path", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockInvoke.mockResolvedValueOnce(["/home/user/projects/myapp", "/home/user/projects/otherapp"]); // scan_repositories
    render(<App />);
    expect(await screen.findByText("myapp")).toBeInTheDocument();
    expect(screen.getByText("/home/user/projects/myapp")).toBeInTheDocument();
    expect(screen.getByText("otherapp")).toBeInTheDocument();
    expect(screen.getByText("/home/user/projects/otherapp")).toBeInTheDocument();
  });

  it("refreshes repositories after adding a folder", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // scan_repositories (initial)
    mockOpen.mockResolvedValueOnce("/home/user/projects");
    mockInvoke.mockResolvedValueOnce(["/home/user/projects"]); // add_folder
    mockInvoke.mockResolvedValueOnce(["/home/user/projects/myapp"]); // scan_repositories (after add)

    render(<App />);
    await screen.findByText("No repositories found.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ Add Folder" }));
    });

    expect(await screen.findByText("myapp")).toBeInTheDocument();
    expect(screen.getByText("/home/user/projects/myapp")).toBeInTheDocument();
  });
});
